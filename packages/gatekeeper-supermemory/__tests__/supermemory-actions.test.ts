import { describe, expect, it, vi } from "vitest";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type { RpcStub } from "cloudflare:workers";
import {
  SupermemoryStore,
  applySupermemoryAction,
  describeSupermemoryAction,
  rejectSupermemoryAction,
  stageSupermemoryAction,
  takeScopedKeySecret,
} from "../src/supermemory-actions";
import type { SupermemoryApi } from "../src/supermemory-api";
import type { SupermemoryScopedKeyInfo } from "../src/types";

class FakeKv {
  values = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  put<T>(key: string, value: T): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  *list<T>(options: { prefix?: string } = {}): Iterable<[string, T]> {
    for (const [key, value] of this.values) {
      if (!options.prefix || key.startsWith(options.prefix)) yield [key, value as T];
    }
  }
}

function harness(apiOverrides: Partial<SupermemoryApi> = {}) {
  const saved: SupermemoryScopedKeyInfo[] = [];
  const registry = {
    async saveScopedKey(info: SupermemoryScopedKeyInfo) { saved.push(info); },
    async markScopedKeyRevoked(id: string) {
      const key = saved.find(value => value.id === id);
      if (key) key.revoked = true;
    },
  };
  const api = apiOverrides as SupermemoryApi;
  const store = new SupermemoryStore(new FakeKv() as any, api, registry);
  const submitAction = vi.fn(async () => {});
  const queue = { submitAction } as unknown as RpcStub<ApprovalQueue>;
  return { store, queue, submitAction, saved };
}

describe("Supermemory approval actions", () => {
  it("persists an action before submitting it and never calls the service inline", async () => {
    const remember = vi.fn();
    const { store, queue, submitAction } = harness({ remember } as Partial<SupermemoryApi>);
    const action = {
      type: "remember" as const,
      containerTag: "agent-research",
      input: { content: "Use Cloudflare first" },
      provisionalId: "~memory:1",
    };

    const id = await stageSupermemoryAction(store, queue, action);

    expect(remember).not.toHaveBeenCalled();
    expect(store.getAction(id)?.state).toBe("pending");
    expect(submitAction).toHaveBeenCalledWith(id, expect.objectContaining({ implementsRevert: true }));
  });

  it("performs the remote write only from applyAction and resolves the provisional ID", async () => {
    const remember = vi.fn(async () => "memory-real-id");
    const { store, queue } = harness({ remember } as Partial<SupermemoryApi>);
    const action = {
      type: "remember" as const,
      containerTag: "agent-research",
      input: { content: "Use Cloudflare first" },
      provisionalId: "~memory:1",
    };
    const id = await stageSupermemoryAction(store, queue, action);

    await applySupermemoryAction(store, id);

    expect(remember).toHaveBeenCalledOnce();
    expect(store.resolveId("~memory:1")).toBe("memory-real-id");
    expect(store.getAction(id)?.state).toBe("applied");
  });

  it("requests a restart when a rejected action invalidates a provisional capability", async () => {
    const { store, queue } = harness();
    const id = await stageSupermemoryAction(store, queue, {
      type: "addDocument",
      containerTag: "agent-research",
      input: { content: "https://developers.cloudflare.com" },
      provisionalId: "~document:1",
    });

    expect(rejectSupermemoryAction(store, id)).toEqual({ restart: true });
    expect(store.getAction(id)).toBeUndefined();
  });

  it("retains a minted scoped-key secret only until its first reveal", async () => {
    const request = vi.fn(async () => ({
      id: "key-real-id",
      key: "sm_scoped_secret",
      name: "research agent",
      containerTag: "agent-research",
      expiresAt: null,
    }));
    const { store, queue, saved } = harness({ request } as Partial<SupermemoryApi>);
    const id = await stageSupermemoryAction(store, queue, {
      type: "issueScopedKey",
      input: { containerTag: "agent-research", name: "research agent" },
      provisionalId: "~key:1",
    });
    await applySupermemoryAction(store, id);

    expect(takeScopedKeySecret(store, "~key:1")).toMatchObject({ key: "sm_scoped_secret" });
    expect(takeScopedKeySecret(store, "~key:1")).toBeNull();
    expect(saved).toEqual([expect.objectContaining({ id: "key-real-id", revoked: false })]);
  });

  it("retains the approved spaces when a newly-created connector is synchronized", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: "connection-real-id", authLink: null, expiresIn: null })
      .mockResolvedValueOnce({});
    const getConnection = vi.fn(async () => ({
      id: "connection-real-id",
      provider: "github",
      email: null,
      containerTags: [],
      documentLimit: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      lastSyncStatus: null,
    }));
    const { store, queue } = harness({ request, getConnection } as Partial<SupermemoryApi>);
    const createId = await stageSupermemoryAction(store, queue, {
      type: "beginConnection",
      input: { provider: "github", containerTags: ["agent-research"] },
      provisionalId: "~connection:1",
    });
    await applySupermemoryAction(store, createId);
    const syncId = await stageSupermemoryAction(store, queue, {
      type: "syncConnection",
      connectionId: "~connection:1",
    });

    await applySupermemoryAction(store, syncId);

    expect(request).toHaveBeenLastCalledWith("/v3/connections/github/import", {
      method: "POST",
      body: JSON.stringify({ containerTags: ["agent-research"] }),
    });
  });

  it("never places scoped-key secrets in approval descriptions", () => {
    const description = describeSupermemoryAction({
      type: "issueScopedKey",
      input: { containerTag: "agent-research", name: "research agent" },
      provisionalId: "~key:1",
    });
    expect(JSON.stringify(description)).not.toContain("secret");
  });
});
