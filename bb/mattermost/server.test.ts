import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";
import { contract } from "./contract";

it("lists and edits the scheduler's SQLite records in place, preserving cursors and other destinations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-rpc-"));
  const id = "a".repeat(20);
  const init = `import json,sys,sqlite3
db=sqlite3.connect(sys.argv[1])
db.execute("create table watches (id text primary key, data text not null)")
row=dict(id=sys.argv[2], chat="thread1", owner="proj1", rule="QA", interval=5, until=None, push=None,
         status="answer", url="https://mm.example/team/pl/abc", platform="bb", seen={"p":123},
         paused=False, schedule="job", timezone="UTC")
db.execute("insert into watches values (?,?)",(row["id"],json.dumps(row)))
row.update(id="b"*20,platform="orca")
db.execute("insert into watches values (?,?)",(row["id"],json.dumps(row)))
db.commit()`;
  type Handlers = {
    list(): Promise<unknown>;
    finishSetup(input: {id:string; chat:string}): Promise<null>;
    board(input: {answer:number; attention:number; resolved:number}): Promise<unknown>;
    readCard(input: {id:number; revision:number}): Promise<null>;
    saveConnection(input: { url: string; cookie: string }): Promise<unknown>;
    connection(): Promise<unknown>;
    testConnection(input: { url: string; cookie: string }): Promise<unknown>;
    edit(input: {id:string; chat?:string; interval:number; rule:string; push:null; draft:boolean; until:null}): Promise<null>;
  };
  let handlers!: Handlers;
  try {
    execFileSync("python3", ["-c", init, join(dir,"watches.sqlite3"), id]);
    plugin({ agents:{contributeInstructions:()=>{}}, pluginId:"mattermost", settings:{define:()=>({get:async()=>({stateDirectory:dir})})},
      sdk:{threads:{get: async ({threadId}: {threadId:string}) => ({id:threadId, projectId:"proj1", environmentId:"new-env", visibility:"visible"})},
        plugins:{list:async()=>({plugins:[{id:"mattermost",rootDir:process.cwd()}]})}},
      storage:{kv:{get:async()=>undefined}},realtime:{publish:()=>{}},
      rpc:{register: (_:unknown,h:Handlers)=>{handlers=h;}} } as unknown as BbPluginApi);
    vi.stubEnv("MM_CONFIG", join(dir, "mm.env"));
    expect(await handlers.connection()).toEqual({ url: "", hasCookie: false });
    const credentials = { url: "https://mm.example", cookie: "session=fixture" };
    const publicConfig = { url: credentials.url, hasCookie: true };
    expect(await handlers.saveConnection(credentials)).toEqual(publicConfig);
    expect(await handlers.connection()).toEqual(publicConfig);
    await expect(handlers.testConnection({ url: "https://other.example", cookie: "" })).rejects.toThrow("Введите cookie");
    const read = async () => contract.list.output.parse(await handlers.list()).watches;
    expect(await read()).toMatchObject([{id,status:"answer",interval:5}]);
    const offsets = { answer: 0, attention: 0, resolved: 0 };
    const cards = async () => contract.board.output.parse(await handlers.board(offsets)).answer.rows;
    const [card] = await cards();
    expect(card).toMatchObject({ url: "https://mm.example/team/pl/abc", opened: false });
    await expect(handlers.readCard({ id: card!.id, revision: card!.revision })).resolves.toBeNull();
    expect((await cards())[0]?.opened).toBe(true);
    const input = {id,interval:12,rule:"Только апрув",push:null,draft:true,until:null};
    await handlers.edit(input);
    expect(await read()).toMatchObject([{...input,status:"answer",schedule:"job"}]);
    await expect(handlers.edit({...input,id:"b".repeat(20)})).rejects.toThrow("Only active BB");
    const cursor = execFileSync("python3", ["-c", 'import sqlite3,sys,json;print(json.loads(sqlite3.connect(sys.argv[1]).execute("select data from watches where id=?",(sys.argv[2],)).fetchone()[0])["seen"]["p"])',join(dir,"watches.sqlite3"),id]);
    expect(cursor.toString().trim()).toBe("123");

    // Recover a partially created native job after the thread changed environment.
    const pending = `import json,sqlite3,sys
db=sqlite3.connect(sys.argv[1])
row=json.loads(db.execute("select data from watches where id=?",(sys.argv[2],)).fetchone()[0])
row.update(schedule=None,setup_pending=True,environment="old-env")
db.execute("update watches set data=? where id=?",(json.dumps(row),row["id"]))
db.commit()`;
    const dbFile = join(dir, "watches.sqlite3");
    execFileSync("python3", ["-c", pending, dbFile, id]);
    const native = join(dir, "bb-test");
    writeFileSync(native, `#!/bin/sh
case "$2" in
  list) echo '[{"id":"recovered","name":"mm-watch-${id}","enabled":false}]' ;;
  update|resume) exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
    vi.stubEnv("BB_CLI", native);
    await expect(handlers.finishSetup({ id, chat: "other-chat" })).rejects.toThrow("другому треду");
    expect(await read()).toMatchObject([{ setup_pending: true, schedule: null }]);
    await expect(handlers.finishSetup({ id, chat: "thread1" })).resolves.toBeNull();
    expect(await read()).toMatchObject([{ schedule: "recovered", interval: 12 }]);
    const row = JSON.parse(execFileSync("python3", ["-c", 'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select data from watches where id=?",(sys.argv[2],)).fetchone()[0])', dbFile, id]).toString());
    expect(row.environment).toBe("new-env");
    expect(row.setup_pending).toBeUndefined();
    await handlers.edit({...input, chat:"other-chat"});
    expect(await read()).toMatchObject([{ id, chat:"other-chat", rule:"Только апрув", schedule:"recovered" }]);
  } finally { vi.unstubAllEnvs(); rmSync(dir,{recursive:true,force:true}); }
});
