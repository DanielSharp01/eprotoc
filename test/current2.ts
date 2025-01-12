/* eslint-disable */

import _m0 from "protobufjs/minimal";

export interface Test {
  test: number;
}

function createBaseTest(): Test {
  return { test: 0 };
}

export const Test = {
  encode(message: Test, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.test !== 0) {
      writer.uint32(8).int32(message.test);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Test {
    const reader =
      input instanceof _m0.Reader ? input : _m0.Reader.create(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseTest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break;
          }

          message.test = reader.int32();
          continue;
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skipType(tag & 7);
    }
    return message;
  },

  fromJSON(object: any): Test {
    return { test: isSet(object.id) ? globalThis.Number(object.id) : 0 };
  },

  toJSON(message: Test): unknown {
    const obj: any = {};
    if (message.test !== 0) {
      obj.id = Math.round(message.test);
    }
    return obj;
  },

  create(base?: DeepPartial<Test>): Test {
    return Test.fromPartial(base ?? ({} as any));
  },
  fromPartial(object: DeepPartial<Test>): Test {
    const message = createBaseTest();
    message.test = object.test ?? 0;
    return message;
  },
};

type Builtin =
  | Date
  | Function
  | Uint8Array
  | string
  | number
  | boolean
  | undefined;
export type DeepPartial<T> = T extends Builtin
  ? T
  : T extends globalThis.Array<infer U>
  ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : T extends {}
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}

export type TestServiceDefinition = typeof TestServiceDefinition;
export const TestServiceDefinition = {
  name: "TestService",
  fullName: "test.TestService",
  methods: {
    simple: {
      name: "simple",
      requestType: Test,
      requestStream: false,
      responseType: Test,
      responseStream: false,
      options: {},
    },
  },
} as const;
