const basic = require('./grammar/basic.js')
const id = require('./grammar/id.js')
const import_ = require('./grammar/import.js')
const module_ = require('./grammar/module.js')
const type = require('./grammar/type.js')

module.exports = grammar({
  name: 'haskell_persistent',

  /**
   * These rules may occur anywhere in the grammar and don't have to be specified.
   */
  extras: $ => [
    /\p{Zs}/,
    /\n/,
    /\r/,
    $.comment
  ],

  externals: $ => [
    $._newline,
    $._indent,
    $._dedent,
  ],

  precedences: _ => [
    [
      'context-empty',
      'con_unit',
    ],
    [
      'infix-type',
      'btype',
    ],
    [
      'function-type',
      'type',
    ],
    [
      'attribute-value-number-literal',
      'attribute-value-no-quotes-string'
    ]
  ],

  inline: $ => [
    $._number,
    $._stringly,
    $._qvarid,
    $._operator_minus,
    $._qvarsym,
    $._qvarsym_nominus,
    $._var,
    $._qvar,
    $._tyvar,
    $._qconid,
    $._qconsym,
    $._con,
    $._conop,
    $._qconop,
    $._op,
    $._qop_nominus,
    $._gcon_literal,
    $._gcon,
    $._tyconid,
    $._qtyconid,
    $._qtyconsym,
    $._qtycon,
    $._gtycon,
    $._simple_tycon,
    $._simple_tyconop,
    $._simple_qtyconop,
    $._quantifiers,
    $._tyfam_pat_prefix,
    $._tyfam_pat_infix,
    $._qualifying_module,
  ],

  conflicts: $ => [
    /**
     * This could be done with the second named precedence further up, but it somehow overrides symbolic infix
     * constructors.
     * Needs more investigation.
     */
    [$._type_infix, $.type_infix],

    /**
     * Optional context for a data/newtype decl with infix types:
     *
     * data a ~ b => A a b
     * data a + b
     */
    [$.type_name, $._simpletype_infix],

    /**
     * Same as above, but with regular types:
     *
     * data A a b
     * data C a b => A a b
     * data C Int a => A a
     * data B Int ~ B a => A a
     */
    [$.type_name, $._simpletype],
    [$._atype, $.constraint],

    /**
     * Constraints and parenthesized types.
     *
     * data (A a) => A
     * data (A a) %% A => A
     *
     * After the `a`, the closing paren is ambiguous.
     */
    [$._type_infix, $.constraint],

    /**
     * Ambiguity between symbolic and regular type family equations.
     */
    [$.type_name, $.tyfam_pat],

    /**
     * Same as `exp_apply`, but for types.
     */
    [$.type_apply, $._btype],
    [$.type_apply],

    /**
     * Implicit parameters have slightly weird restrictions.
     */
    [$._type_or_implicit, $._context_constraints],

    /**
     * General kind signatures cause `(a :: k)` to be ambiguous.
     * This problem might be solvable if `type.js` were to be refactored.
     */
    [$.annotated_type_variable, $.type_name],

  ],

  word: $ => $._varid,

  // Parsing type names and field names is based on tree-sitter-haskell, the rest is based on the parsing from Database.Persist.Quasi.Internal
  rules: {
    quasi_quotation: $ => repeat($.entity_definition),

    entity_definition: $ => seq(
      $._entity_header,
      optional(seq($._indent, $.entity_body, $._dedent))
    ),

    entity_body: $ => repeat1($._entity_line_definition),

    is_sum_marker: _ => '+',

    comment: _ => /(#|--).*/,

    _entity_name: $ => $.type_name,

    _field_name: $ => $.variable,

    _haskell_constraint_name: $ => $.constructor,

    // The attributes may follow the type. The _atype, as opposed to _type, ensures that attributes would not be mistaken for other types that are applied to the actual type.
    // For example, "name Text Maybe" should be parsed as (with concise imaginary syntax) "name :: Text, has attribute Maybe", not "name :: Text Maybe".
    _persistent_type: $ => $._atype,

    _entity_header: $ => seq(
      optional($.is_sum_marker),
      field('name', $._entity_name),
      repeat($._entity_attribute),
      $._newline
    ),

    _entity_line_definition: $ => seq(
      choice(
        $._entity_key,
        $.field_definition,
        $.unique_constraint,
        $.foreign_constraint,
        $.entity_deriving
      ),
      $._newline
    ),

    _entity_key: $ => choice(
      $.surrogate_key,
      $.natural_key
    ),

    surrogate_key: $ => seq(
      'Id',
      field('type', $._persistent_type),
      optional($._list_of_attributes_start_with_no_other)
    ),

    natural_key: $ => seq(
      'Primary',
      $._list_of_fields,
      optional($._list_of_attributes_start_with_no_other)
    ),

    _list_of_fields: $ => alias(repeat1($._field_name), $.fields),

    _entity_attribute: $ => $._attribute,

    _field_attribute: $ => $._attribute,

    _attribute: $ => choice(
      $.key_value_attribute,
      $.exclamation_mark_attribute,
      $.other_attribute
    ),

    _attribute_no_other: $ => choice(
      $.key_value_attribute,
      $.exclamation_mark_attribute
    ),

    _list_of_attributes_start_with_no_other: $ => alias(
      seq($._attribute_no_other, repeat($._attribute)),
      $.attributes
    ),

    key_value_attribute: $ => seq(
      $._key_value_attribute_key,
      $._key_value_attribute_value
    ),

    // FIXME: Parse key name with "=" as a single token to avoid ambiguity between an attribute key and a field name. There must be a cleaner way - perhaps parse field name and attribue key as the same token, so that the lexical precedence rule can resolve it.
    _key_value_attribute_key: $ => alias(/\w+=/, $.name),

    _key_value_attribute_value: $ => choice(
      $._stringly,
      alias(
        token(prec('attribute-value-number-literal', /[0-9][0-9_]*/)),
        $.number
      ),
      alias(
        token(prec('attribute-value-no-quotes-string', /[^\s]+/)),
        $.string
      )
    ),

    exclamation_mark_attribute: _ => /![\w-]+/,

    // Maybe, MigrationOnly, noreference, and others
    other_attribute: _ => /[\w@]+/,

    field_definition: $ => seq(
      optional($._field_strictness_prefix),
      field('name', $._field_name),
      field('type', $._persistent_type),
      alias(repeat($._field_attribute), $.attributes)
    ),

    _field_strictness_prefix: _ => /[~!]/,

    cascade_action: _ => /(OnDelete|OnUpdate)(Cascade|Restrict|SetNull|SetDefault)/,

    // Persistent has yet one more style of unique declaration that starts with a whole word "Unique". It has no examples or tests, and github code search finds no examples of it either.
    unique_constraint: $ => seq(
      $._haskell_constraint_name,
      $._list_of_fields,
      optional($._list_of_attributes_start_with_no_other)
    ),

    _unique_constraint_attribute: $ => choice(
      $.exclamation_mark_attribute,
      $.key_value_attribute
    ),

    sql_constraint_name: _ => /[a-zA-Z][\w]+/,

    foreign_constraint: $ => seq(
      'Foreign',
      $._entity_name,
      repeat($.cascade_action),
      $.sql_constraint_name,
      $._list_of_fields,
      optional(
        seq(
          'References',
          alias($._list_of_fields, $.references)
        )
      ),
      optional($._list_of_attributes_start_with_no_other)
    ),

    // See deriving in tree-sitter-haskell/grammar/data.js for the complete syntax. Persistent only supports a list of class names
    entity_deriving: $ => seq(
      'deriving',
      repeat1(field('class', $._qtyconid))
    ),

    // Extra definitions that the haskell grammar depends on. In tree-sitter-haskell they are external and are defined in scanner.c.
    comma: _ => ',',
    _dot: _ => '.',
    // See https://www.haskell.org/onlinereport/haskell2010/haskellch2.html#x7-180002.4. The definitions below ignore the reserved operators for simplicity.
    _varsym: _ => /[!#$%&⋆+./<=>?@\|^~:]+/,
    _consym: _ => /:[!#$%&⋆+./<=>?@\|^~:-]+/,
    _tyconsym: _ => /[!#$%&⋆+./<=>?@\|^~:-]+/,

    ...basic,
    ...id,
    ...import_,
    ...module_,
    ...type
  }
});
