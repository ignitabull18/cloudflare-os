import { afterEach, describe, expect, it, vi } from "vitest";
import { SupermemoryApi, SupermemoryApiError } from "../src/supermemory-api";

afterEach(() => vi.unstubAllGlobals());

describe("SupermemoryApi", () => {
  it("sends the organization API key only as a bearer credential", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer sm_secret");
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await new SupermemoryApi(async () => "sm_secret").validateOrganizationKey();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.supermemory.ai/v3/container-tags/list",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("does not expose an out-of-container document capability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "doc-other",
      containerTags: ["other-agent"],
      title: "Private document",
      status: "done",
      type: "text",
      summary: null,
      metadata: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })));

    const api = new SupermemoryApi(async () => "sm_secret");
    await expect(api.getDocument("bound-agent", "doc-other")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("always scopes search to the bound container and defaults to hybrid retrieval", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        containerTag: "research-agent",
        q: "deployment notes",
        searchMode: "hybrid",
      });
      return Response.json({ results: [], timing: 1, total: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new SupermemoryApi(async () => "sm_secret")
      .search("research-agent", "deployment notes");
  });

  it("returns bounded API errors without including the bearer key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "bad credentials" },
      { status: 401 },
    )));

    const api = new SupermemoryApi(async () => "sm_secret");
    let caught: unknown;
    try {
      await api.validateOrganizationKey();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupermemoryApiError);
    expect(String(caught)).not.toContain("sm_secret");
  });
});
