import {
  ACTION,
  COLORS,
  RESOLVE_EVENT,
  RESOLVE_STATUS,
} from "./lib/constant.mjs";
import { DnsServer } from "./lib/server.mjs";
import { IP, IPQueue } from "./lib/ip.mjs";
import { Ping, PingQueue } from "./lib/ping.mjs";
import { Painter } from "./lib/painter.mjs";
import { interval, sleep } from "./lib/utils.mjs";
import { stdout, watchKeypress } from "./lib/stdout.mjs";
import { HostSetting } from "./lib/host.mjs";

export { COLORS };

export { stdout };

const RESOLVED_IPS = new Set();

export async function resolve(options) {
  const { host } = options;
  const hostSetting = new HostSetting(host);
  const startTime = new Date();
  const ipQueue = new IPQueue();
  const pingQueue = new PingQueue();
  let resolveStatus = RESOLVE_STATUS.PENDING;

  const server = new DnsServer(options);
  const painter = new Painter(host);

  await hostSetting.getContent();
  server.resolve(host);
  painter.print(ipQueue, resolveStatus, hostSetting);

  interval(() => painter.print(ipQueue, resolveStatus, hostSetting), 100);

  let isFirstIp = false;
  server.on(RESOLVE_EVENT.FULFILLED, (data) => {
    data.ips.forEach((addr) => {
      let ip = ipQueue.get(addr);

      if (ip) {
        return;
      }

      ip = new IP({
        server: data.server,
        addr,
        resolveTime: new Date() - startTime,
        selected: !isFirstIp,
      });
      isFirstIp = true;

      ipQueue.set(addr, ip);

      const ping = new Ping(addr);

      ping.onResponse((res) => {
        ip.received ||= 0;
        ip.received += +res.received;
        ip.time = res.time;
      });

      pingQueue.set(addr, ping);
    });
  });

  server.on(RESOLVE_EVENT.FINISHED, async (data) => {
    resolveStatus = RESOLVE_STATUS.SUCCESS;

    if (!ipQueue?.size) {
      resolveStatus = RESOLVE_STATUS.FAIL;
      await sleep(100);
      stdout.error(
        `can not resolve ${host}, please make sure host exists and is reachable\n`
      );
      process.exit(1);
    }
  });

  function onExit(code) {
    stdout.showCursor();
    pingQueue.exit();

    process.exit(typeof code === "number" ? code : 0);
  }

  process.on("exit", onExit);
  process.on("SIGINT", onExit);
  process.on("uncaughtException", (err) => {
    console.error(
      painter.color(
        err + (err.code === "EACCES" ? "\nAre you running as root?" : ""),
        COLORS.red
      )
    );
    onExit(1);
  });
  watchKeypress((str, key) => {
    if (key.ctrl && ["c", "d"].includes(key.name)) {
      onExit(0);
    }

    const move = {
      left: ACTION.prev,
      right: ACTION.next,
    }[key.name];

    move && ipQueue.selectIP(move);

    const selectedIP = ipQueue.getSelectedIP();
    if (key.name === "return" && selectedIP) {
      hostSetting.setHostIP(selectedIP);
    }
  });
}
