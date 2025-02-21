import { inspect } from "util";
import { TestServiceDefinition } from "../../output/current";

const requestBuffer = TestServiceDefinition.simple.requestSerialize({
  count: 3,
  recursion: [
    new Map([
      ["asd", 3],
      ["asd2", 2],
    ]),
  ],
});

console.log(requestBuffer);

const requestReconstructed =
  TestServiceDefinition.simple.requestDeserialize(requestBuffer);

console.log(inspect(requestReconstructed, false, null, true));
