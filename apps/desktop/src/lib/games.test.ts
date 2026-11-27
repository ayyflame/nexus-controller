import { test } from "node:test";
import assert from "node:assert/strict";
import { pickable } from "./games.ts";

test("recently used programs already linked to the profile aren't offered again", () => {
  assert.deepEqual(pickable(["cod.exe", "discord.exe", "steam.exe"], ["COD.exe"]), ["discord.exe", "steam.exe"]);
  assert.deepEqual(pickable([], ["cod.exe"]), []);
});
