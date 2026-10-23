import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaPoller } from "../../../src/modules/usage/poller.js";

afterEach(() => vi.useRealTimers());

function setup(fetch: () => Promise<number> = async () => 1) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const fetchSpy = vi.fn(fetch);
  const apply = vi.fn(async (_n: number) => {});
  const onError = vi.fn();
  return { fetchSpy, apply, onError, poller: new QuotaPoller({ fetch: fetchSpy, apply, onError }) };
}

describe("QuotaPoller", () => {
  it("reads at start and then every five minutes until stopped", async () => {
    const { fetchSpy, apply, poller } = setup();
    poller.start();
    await poller.idle();
    expect(apply).toHaveBeenCalledWith(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await poller.idle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reads on demand at most once a minute and still reads once after the last request", async () => {
    const { fetchSpy, poller } = setup();
    poller.request();
    await poller.idle();
    await vi.advanceTimersByTimeAsync(10_000);
    poller.request();
    poller.request();
    await vi.advanceTimersByTimeAsync(49_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await poller.idle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("never overlaps reads", async () => {
    let release!: () => void;
    const { fetchSpy, poller } = setup();
    fetchSpy.mockImplementationOnce(() => new Promise((r) => (release = () => r(2))));
    poller.request();
    await vi.advanceTimersByTimeAsync(61_000);
    poller.request();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await poller.idle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("reports a failed read without applying and keeps polling", async () => {
    const { fetchSpy, apply, onError, poller } = setup();
    fetchSpy.mockRejectedValueOnce(new Error("boom"));
    poller.request();
    await poller.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    poller.request();
    await poller.idle();
    expect(apply).toHaveBeenCalledWith(1);
    poller.stop();
  });

  it("ignores requests and drops a read in flight after stop", async () => {
    let release!: () => void;
    const { fetchSpy, apply, poller } = setup();
    fetchSpy.mockImplementationOnce(() => new Promise((r) => (release = () => r(2))));
    poller.request();
    poller.stop();
    release();
    await poller.idle();
    expect(apply).not.toHaveBeenCalled();
    poller.request();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
