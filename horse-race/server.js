// 경주마 레이싱 MCP 서버
// - /mcp      : ChatGPT 커스텀 커넥터가 접속하는 MCP 엔드포인트 (Streamable HTTP, 인증 없음)
// - /         : 강의실 화면에 띄울 실시간 경주 화면
// - /admin    : 강사용 조작 (ADMIN_KEY 필요)
import express from "express";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "change-me";
const TRACK_LENGTH = Number(process.env.TRACK_LENGTH || 100);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 3000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 40);
const HORSES = ["🐎", "🦄", "🐴", "🦓", "🐂", "🐆", "🐕", "🐇", "🐢", "🦖"];

// ---------------- 게임 상태 (메모리) ----------------
const game = {
  phase: "lobby", // lobby | racing | finished
  players: new Map(), // id -> { id, name, horse, pos, lastMove, moves, finishedAt }
  ranking: [], // 도착 순서대로 player id
  startedAt: null,
  log: [],
};

function publicState() {
  return {
    phase: game.phase,
    trackLength: TRACK_LENGTH,
    players: [...game.players.values()].map(({ id, ...p }) => ({
      ...p,
      rank: game.ranking.indexOf(id) + 1 || null,
    })),
    log: game.log.slice(-8),
  };
}

const clients = new Set();
function broadcast() {
  const data = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(data);
}
function addLog(msg) {
  game.log.push(msg);
  if (game.log.length > 50) game.log.shift();
}

function joinRace(nickname) {
  const name = nickname.trim().slice(0, 16);
  if (!name) return { ok: false, message: "닉네임이 비어 있어요." };
  for (const p of game.players.values()) {
    if (p.name === name) return { ok: false, message: `'${name}'은(는) 이미 사용 중인 닉네임이에요. 다른 이름을 골라주세요.` };
  }
  if (game.players.size >= MAX_PLAYERS) return { ok: false, message: "참가 인원이 가득 찼어요." };
  if (game.phase !== "lobby") return { ok: false, message: "이미 경주가 시작됐어요. 다음 판을 기다려주세요." };
  const id = randomBytes(3).toString("hex").toUpperCase();
  const horse = HORSES[game.players.size % HORSES.length];
  game.players.set(id, { id, name, horse, pos: 0, lastMove: 0, moves: 0, finishedAt: null });
  addLog(`${horse} ${name} 입장!`);
  broadcast();
  return { ok: true, playerCode: id, horse, name, message: `${horse} ${name}(으)로 참가했어요. 참가 코드는 ${id} 입니다. 경주가 시작되면 '전진'이라고 말해주세요!` };
}

function moveForward(code) {
  const p = game.players.get(code.trim().toUpperCase());
  if (!p) return { ok: false, message: "참가 코드를 찾을 수 없어요. 먼저 join_race로 참가해주세요." };
  if (game.phase === "lobby") return { ok: false, message: "아직 출발 전이에요! 강사님이 시작할 때까지 기다려주세요." };
  if (p.finishedAt) return { ok: true, message: `${p.name}은(는) 이미 ${game.ranking.indexOf(p.id) + 1}등으로 도착했어요! 🏁` };
  if (game.phase === "finished") return { ok: false, message: "경주가 끝났어요." };
  const now = Date.now();
  const wait = p.lastMove + COOLDOWN_MS - now;
  if (wait > 0) return { ok: false, message: `말이 숨을 고르는 중... ${Math.ceil(wait / 1000)}초 뒤에 다시 전진하세요.` };

  const roll = Math.random();
  const step = roll < 0.1 ? 0 : roll > 0.92 ? 12 : 3 + Math.floor(Math.random() * 5); // 꽝 10%, 질주 8%, 보통 3~7
  p.pos = Math.min(TRACK_LENGTH, p.pos + step);
  p.lastMove = now;
  p.moves++;
  let message =
    step === 0 ? `${p.horse} 앗, 말이 한눈을 팔았어요! (+0)` :
    step >= 12 ? `${p.horse} 질주!!! +${step}칸 🔥` :
    `${p.horse} 전진! +${step}칸`;

  if (p.pos >= TRACK_LENGTH) {
    p.finishedAt = now;
    game.ranking.push(p.id);
    const rank = game.ranking.length;
    addLog(`🏁 ${p.horse} ${p.name} ${rank}등 도착!`);
    message += ` 🏁 결승선 통과! ${rank}등!`;
    if (rank >= Math.min(3, game.players.size)) game.phase = "finished";
  }
  broadcast();
  return { ok: true, step, position: p.pos, trackLength: TRACK_LENGTH, message };
}

// ---------------- MCP 서버 ----------------
function buildMcpServer() {
  const server = new McpServer({ name: "horse-race", version: "1.0.0" });
  const asResult = (obj) => ({
    content: [{ type: "text", text: JSON.stringify(obj) }],
    structuredContent: obj,
  });

  server.registerTool(
    "join_race",
    {
      title: "경주 참가",
      description:
        "경주마 레이싱 게임에 참가합니다. 사용자가 '참가', '입장', '나도 할래' 등을 말하면 닉네임을 받아 호출하세요. 돌려받은 playerCode는 이후 move_forward 호출에 꼭 필요하니 대화 내내 기억하세요.",
      inputSchema: { nickname: z.string().describe("화면에 표시될 닉네임 (최대 16자)") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ nickname }) => asResult(joinRace(nickname))
  );

  server.registerTool(
    "move_forward",
    {
      title: "전진",
      description:
        "내 경주마를 앞으로 전진시킵니다. 사용자가 '전진', '달려', 'go', '이랴' 등 말을 움직이라는 뜻의 말을 하면 즉시 호출하세요. 한 번 말할 때 한 번만 호출합니다. 결과 message를 짧고 신나게 전달하세요.",
      inputSchema: { playerCode: z.string().describe("join_race에서 받은 참가 코드") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ playerCode }) => asResult(moveForward(playerCode))
  );

  server.registerTool(
    "race_status",
    {
      title: "경주 현황",
      description: "현재 경주 상태와 순위를 확인합니다. 사용자가 '현황', '순위', '몇 등이야?' 등을 물으면 호출하세요.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const s = publicState();
      const standings = [...s.players].sort((a, b) => b.pos - a.pos).map((p, i) => ({
        place: i + 1, name: p.name, horse: p.horse, position: p.pos, finishedRank: p.rank,
      }));
      return asResult({ phase: s.phase, trackLength: s.trackLength, standings });
    }
  );
  return server;
}

// ---------------- HTTP ----------------
const app = express();
app.use(express.json());

// 상태 없는(stateless) Streamable HTTP: 요청마다 서버/트랜스포트를 새로 만든다
app.post("/mcp", async (req, res) => {
  try {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});
app.all("/mcp", (_req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null })
);

app.get("/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

function requireAdmin(req, res, next) {
  if ((req.query.key || req.body?.key) !== ADMIN_KEY) return res.status(403).json({ error: "관리자 키가 틀렸어요" });
  next();
}
app.post("/admin/start", requireAdmin, (_req, res) => {
  if (game.players.size === 0) return res.status(400).json({ error: "참가자가 없어요" });
  for (const p of game.players.values()) Object.assign(p, { pos: 0, lastMove: 0, moves: 0, finishedAt: null });
  game.ranking = [];
  game.phase = "racing";
  game.startedAt = Date.now();
  addLog("🔫 출발!!!");
  broadcast();
  res.json({ ok: true });
});
app.post("/admin/rematch", requireAdmin, (_req, res) => {
  for (const p of game.players.values()) Object.assign(p, { pos: 0, lastMove: 0, moves: 0, finishedAt: null });
  game.ranking = [];
  game.phase = "lobby";
  addLog("🔄 같은 멤버로 다시 대기");
  broadcast();
  res.json({ ok: true });
});
app.post("/admin/reset", requireAdmin, (_req, res) => {
  game.players.clear();
  game.ranking = [];
  game.phase = "lobby";
  game.log = [];
  addLog("🧹 새 게임 — 참가를 받습니다");
  broadcast();
  res.json({ ok: true });
});
app.post("/admin/kick", requireAdmin, (req, res) => {
  for (const [id, p] of game.players) if (p.name === req.body?.name) game.players.delete(id);
  broadcast();
  res.json({ ok: true });
});

app.use(express.static(new URL("./public", import.meta.url).pathname));

app.listen(PORT, () => console.log(`🐎 horse-race on :${PORT}  (MCP: /mcp, 화면: /, 관리: /admin.html)`));
