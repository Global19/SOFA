import {
  GraphQLSchema,
  GraphQLObjectType,
  isObjectType,
  getNamedType,
  isUnionType,
  DocumentNode,
  OperationDefinitionNode,
  VariableDefinitionNode,
  isNonNullType,
  SelectionNode,
  InlineFragmentNode,
  GraphQLNamedType,
  SelectionSetNode,
  isScalarType,
  TypeNode,
  isListType,
  ArgumentNode,
  GraphQLField,
  isEqualType,
} from 'graphql';
import * as changeCase from 'change-case';

export function buildOperation({
  schema,
  type,
  fieldName,
  models,
}: {
  schema: GraphQLSchema;
  type: GraphQLObjectType;
  fieldName?: string;
  models: string[];
}) {
  // if it has a field, it means it's a query or mutation
  if (fieldName) {
    return buildRootFieldQuery({
      schema,
      type,
      fieldName,
      models,
    });
  }

  return buildModelQuery({
    type,
    models,
  });
}

function buildModelQuery({
  type,
  models,
}: {
  type: GraphQLObjectType;
  models: string[];
}) {
  const operationName = `get${changeCase.pascal(type.name)}Type`;

  const operationNode: OperationDefinitionNode = {
    kind: 'OperationDefinition',
    operation: 'query',
    name: {
      kind: 'Name',
      value: operationName,
    },
    variableDefinitions: [
      {
        kind: 'VariableDefinition',
        variable: {
          kind: 'Variable',
          name: {
            kind: 'Name',
            value: 'id',
          },
        },
        type: {
          kind: 'NonNullType',
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'ID',
            },
          },
        },
      },
    ],
    selectionSet: {
      kind: 'SelectionSet',
      selections: [
        {
          kind: 'Field',
          name: {
            kind: 'Name',
            value: '_getRESTModelById',
          },
          arguments: [
            {
              kind: 'Argument',
              name: {
                kind: 'Name',
                value: 'typename',
              },
              value: {
                kind: 'StringValue',
                block: false,
                value: type.name,
              },
            },
            {
              kind: 'Argument',
              name: {
                kind: 'Name',
                value: 'id',
              },
              value: {
                kind: 'Variable',
                name: {
                  kind: 'Name',
                  value: 'id',
                },
              },
            },
          ],
          selectionSet: {
            kind: 'SelectionSet',
            selections: [
              {
                kind: 'InlineFragment',
                typeCondition: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: type.name,
                  },
                },
                selectionSet: resolveSelectionSet({
                  skipModel: true,
                  type,
                  models,
                })!,
              },
            ],
          },
        },
      ],
    },
  };
  const document: DocumentNode = {
    kind: 'Document',
    definitions: [operationNode],
  };

  return document;
}

function buildRootFieldQuery({
  schema,
  type,
  fieldName,
  models,
}: {
  schema: GraphQLSchema;
  type: GraphQLObjectType;
  fieldName: string;
  models: string[];
}) {
  let operation: 'query' | 'mutation';

  if (isEqualType(type, schema.getQueryType()!)) {
    operation = 'query';
  } else if (isEqualType(type, schema.getMutationType()!)) {
    operation = 'mutation';
  } else {
    throw new Error('Subscription is not supported');
  }

  const operationName = `get${changeCase.pascal(fieldName)}${changeCase.pascal(
    operation,
  )}`;
  const field = type.getFields()[fieldName];

  const operationNode: OperationDefinitionNode = {
    kind: 'OperationDefinition',
    operation,
    name: {
      kind: 'Name',
      value: operationName,
    },
    variableDefinitions:
      field.args && field.args.length
        ? field.args.map<VariableDefinitionNode>(arg => {
            let typeNode: TypeNode;

            if (isNonNullType(arg.type)) {
              typeNode = {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType', // TODO: possible ListType and even more nested types
                  name: {
                    kind: 'Name',
                    value: arg.type.ofType.toString(),
                  },
                },
              };
            } else if (isListType(arg.type)) {
              typeNode = {
                kind: 'ListType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: arg.type.ofType.toString(),
                  },
                },
              };
            } else {
              typeNode = {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: arg.type.name,
                },
              };
            }

            return {
              kind: 'VariableDefinition',
              variable: {
                kind: 'Variable',
                name: {
                  kind: 'Name',
                  value: arg.name,
                },
              },
              type: typeNode,
              defaultValue: arg.defaultValue,
            };
          })
        : [],
    selectionSet: {
      kind: 'SelectionSet',
      selections: [
        resolveFieldNode({
          field,
          models,
          skipModel: true,
        }),
      ],
    },
  };
  const document: DocumentNode = {
    kind: 'Document',
    definitions: [operationNode],
  };

  return document;
}

function resolveSelectionSet({
  type,
  models,
  skipModel,
}: {
  type: GraphQLNamedType;
  models: string[];
  skipModel?: boolean;
}): SelectionSetNode | undefined {
  if (isUnionType(type)) {
    const types = type.getTypes();

    return {
      kind: 'SelectionSet',
      selections: types.map<InlineFragmentNode>(t => {
        const fields = t.getFields();

        return {
          kind: 'InlineFragment',
          typeCondition: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: t.name,
            },
          },
          selectionSet: {
            kind: 'SelectionSet',
            selections: Object.keys(fields).map(f => {
              return resolveFieldNode({
                field: fields[f],
                models,
              });
            }),
          },
        };
      }),
    };
  }

  if (isObjectType(type)) {
    if (!skipModel && models.includes(type.name)) {
      return {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: {
              kind: 'Name',
              value: 'id',
            },
          },
        ],
      };
    }

    const fields = type.getFields();

    return {
      kind: 'SelectionSet',
      selections: Object.keys(fields).map(fieldName => {
        return resolveFieldNode({
          field: fields[fieldName],
          models,
        });
      }),
    };
  }
}

function resolveFieldNode({
  field,
  models,
  skipModel,
}: {
  field: GraphQLField<any, any>;
  models: string[];
  skipModel?: boolean;
}): SelectionNode {
  const namedType = getNamedType(field.type);
  let args: ArgumentNode[] = [];

  if (field.args && field.args.length) {
    args = field.args.map<ArgumentNode>(arg => {
      return {
        kind: 'Argument',
        name: {
          kind: 'Name',
          value: arg.name,
        },
        value: {
          kind: 'Variable',
          name: {
            kind: 'Name',
            value: arg.name,
          },
        },
      };
    });
  }

  if (!isScalarType(namedType)) {
    return {
      kind: 'Field',
      name: {
        kind: 'Name',
        value: field.name,
      },
      selectionSet: resolveSelectionSet({ type: namedType, models, skipModel }),
      arguments: args,
    };
  }

  return {
    kind: 'Field',
    name: {
      kind: 'Name',
      value: field.name,
    },
    arguments: args,
  };
}