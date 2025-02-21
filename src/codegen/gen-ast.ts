import { safeIdentifier } from "./utils";

export type GenNode =
  | PrimitiveGenNode
  | NullableGenNode
  | LenGenNode
  | ArrayGenNode
  | StructGenNode
  | FieldGenNode
  | SwitchGenNode
  | MapValueGenNode;

export type NullableGenNode = {
  type: "nullable";
  sub: GenNode;
};

export type PrimitiveGenNode = {
  type: "primitive";
  writer: (value: string) => string[];
  reader: (value: string) => string[];
};

export type StructGenNode = {
  type: "struct";
  initializeValue: (value: string) => string[];
  fields: FieldGenNode[];
};

export type FieldGenNode = {
  type: "field";
  ordinal: number;
  wireType: number;
  field: (value: string) => string;
  condition?: (field: string) => string;
  node: GenNode;
};

export type LenGenNode = {
  type: "len";
  sub: GenNode;
};

export type ArrayGenNode = {
  type: "array";
  sub: GenNode;
};

export type SwitchCondition = {
  value: (value: string) => string;
  node: FieldGenNode;
};

export type SwitchGenNode = {
  type: "switch";
  conditions: SwitchCondition[];
};

export type MapValueGenNode = {
  type: "map-value";
  mapSerialize?: (value: string) => string;
  mapDeserialize?: (value: string) => string;
  node: GenNode;
};
