import { beforeAll } from "bun:test";
import { testChannelIngress } from "@chat-agent-relay/adapter-conformance";
import { DiscordIngress } from "./discord-ingress";

let discordIngress: DiscordIngress;

beforeAll(async () => {
  discordIngress = await DiscordIngress.create();
});

testChannelIngress({
  name: "DiscordIngress (example skeleton)",
  get ingress() {
    return discordIngress;
  },
  expectedChannel: "discord",
  validInput: {
    tenant_id: "tenant_discord_example",
    workspace_id: "ws_discord_example",
    channel_instance_id: "discord_bot_install_example",
    message_id: "1234567890123456789",
    channel_id: "9876543210987654321",
    user_id: "111122223333444455",
    username: "example_user",
    guild_id: "555566667777888899",
    content: "Hello from the custom adapter example.",
  },
  invalidInputs: [
    {
      label: "empty content",
      input: {
        tenant_id: "t1",
        workspace_id: "w1",
        channel_instance_id: "ci1",
        message_id: "m1",
        channel_id: "c1",
        user_id: "u1",
        content: "",
      },
      expectedCode: "missing_field",
    },
    {
      label: "missing message_id",
      input: {
        tenant_id: "t1",
        workspace_id: "w1",
        channel_instance_id: "ci1",
        channel_id: "c1",
        user_id: "u1",
        content: "hi",
      },
      expectedCode: "missing_field",
    },
  ],
});
