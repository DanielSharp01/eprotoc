# eprotoc

`eprotoc` is a compiler written for a modernized version of the protobuf descriptor language. `eprotoc` is designed to be used with typescript for code generation purposes.

## Differences from protobuf

- `eproto` uses packages like module system instead of importing files
- `eproto` supports generics
- `eproto` supports Date as a builtin type
- arrays are now represented with a generic type `Array<TypeArg>`
- oneOf is now a generic type `OneOf<TypeArg1, TypeArg2, ...>`
- `eproto` enums can be string and integer enums as well

- `eproto` does not currently support more complex types such as Map, any, etc.
- `eproto` does not support reserved fields
- `eproto` does not support nested messages
- `eproto` does not support the notion of options

## Development

- [x] tokenizer, parser, analyzer to get all definitions
- [ ] VSCode extension
  - [ ] TextMate grammar for syntax higlighting
  - [ ] Language server integration
- [ ] Language Server
  - [x] Work done to be able to do per file compilation
  - [ ] Workspace support
  - [ ] Semantic token highlighting
  - [ ] Goto definition
  - [ ] Find references
  - [ ] Diagnostics
- [ ] Codegen (TypeScript / Nice GRPC)
  - [ ] Generate encoder
  - [ ] Generate decoder
  - [ ] Generate NiceGRPC service definition