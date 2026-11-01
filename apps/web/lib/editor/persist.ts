import { del, get, set } from "idb-keyval";
import { parseProject, type Project } from "@mss/compositions";

const LAST = "mss:last-project";
const key = (id: string) => `mss:project:${id}`;

export async function saveProject(p: Project): Promise<void> {
  await set(key(p.id), p);
  await set(LAST, p.id);
}

export async function loadLastProject(): Promise<Project | null> {
  try {
    const id = await get<string>(LAST);
    if (!id) return null;
    const raw = await get<unknown>(key(id));
    return raw ? parseProject(raw) : null;
  } catch {
    return null; // corrupt or from an unsupported version: start fresh rather than crash
  }
}

export async function clearProject(id: string): Promise<void> {
  await del(key(id));
  if ((await get<string>(LAST)) === id) await del(LAST);
}
