import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProduction } from "@/config/app";

/**
 * Stockage objet des preuves. Seul l'adaptateur disque local existe ; un adaptateur compatible S3 se branche
 * sur la même interface (NEXT_STEPS). Le dossier n'est JAMAIS servi directement : tout accès passe par
 * `GET /api/v1/proofs/{id}`, qui vérifie les droits.
 */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

/** Clés générées par l'application uniquement : deux UUID. Aucune entrée utilisateur n'entre dans un chemin. */
export const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class LocalDiskStorage implements ObjectStorage {
  readonly name = "local-disk";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new Error("Clé de stockage invalide");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chemin hors du dossier de stockage");
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" }); // jamais d'écrasement
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let override: ObjectStorage | null = null;
let cached: ObjectStorage | null = null;

export function setStorageForTests(storage: ObjectStorage | null): void {
  override = storage;
}

export function getStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  if (override) return override;
  if (!cached) {
    const driver = env.STORAGE_DRIVER ?? "local";
    if (driver !== "local") throw new Error(`STORAGE_DRIVER inconnu : ${driver} (seul « local » est implémenté)`);
    const dir = env.UPLOAD_DIR;
    if (!dir && isProduction(env)) throw new Error("UPLOAD_DIR est obligatoire en production (volume persistant, hors du dossier public)");
    cached = new LocalDiskStorage(dir ?? path.resolve(process.cwd(), ".data", "uploads"));
  }
  return cached;
}
