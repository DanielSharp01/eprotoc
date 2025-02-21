import {
  createClientFactory,
  createChannel,
  ChannelCredentials,
} from "nice-grpc";
import { TestServiceDefinition } from "../../output/current";

const clientFactory = createClientFactory();

const channel = createChannel(
  "0.0.0.0:9000",
  ChannelCredentials.createInsecure()
);
const client = clientFactory.create(TestServiceDefinition, channel);

client
  .simple({ test: 2 })
  .then((res) => console.log(res))
  .catch((err) => console.error(err));
