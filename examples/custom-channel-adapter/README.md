# Custom channel adapter example (Discord-shaped skeleton)

This package is a **minimal pattern reference** for implementing CAR's `ChannelAdapter` contract in your own integration. It is **not** a real Discord client or Gateway listener; it only shows how to:

- Implement the unified `ChannelAdapter` interface (`channelType`, `describeCapabilities()`, `canonicalize()`, `createSender()`)
- Accept arbitrary `unknown` webhook-style payloads and **never throw** from `canonicalize`
- Validate and map platform fields into a **`message.received`** canonical event
- Produce a **stable idempotency key** from provider-stable identifiers (here: tenant + Discord message id)
- Create a `ChannelSender` from a canonical event's `provider_extensions` for delivery
- Run **`@chat-agent-relay/adapter-conformance`** (`testChannelAdapter`) so your adapter stays aligned with the frozen contract harness

## Run tests

From the repository root:

```bash
bun test examples/custom-channel-adapter/src/discord-ingress.test.ts
```

Or from this directory:

```bash
cd examples/custom-channel-adapter && bun test
```

## Related docs

- RFC-style interface: `docs/rfcs/adapters/channel-adapter-interface-spec.md`
- Conformance harness: `packages/adapter-conformance`
