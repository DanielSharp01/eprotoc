import { createServer } from "nice-grpc";
import { TestServiceDefinition } from "../output/current";

const server = createServer();

server.add(TestServiceDefinition, {
  simple: async (test) => {
    console.log(test);
  },
});

const host = "0.0.0.0:9000";
server
  .listen(host)
  .then(() => console.log(`Listening on ${host}`))
  .catch(console.error);
