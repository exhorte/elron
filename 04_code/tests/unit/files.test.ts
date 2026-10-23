import { mkdtemp, readdir, rm as removeDir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sanitizeFileName, sniffContentType } from "@/domain/files";
import { LocalDiskStorage, STORAGE_KEY_PATTERN } from "@/server/storage";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("détection du type réel (magic bytes)", () => {
  it("reconnaît JPEG, PNG, WEBP et PDF", () => {
    expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffContentType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffContentType(ascii("%PDF-1.7\n..."))).toBe("application/pdf");
  });

  it("refuse tout le reste : HTML, SVG, scripts, exécutables, archives, vide", () => {
    for (const sample of [
      ascii("<!doctype html><script>alert(1)</script>"),
      ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
      ascii("<?xml version='1.0'?><svg/>"),
      ascii("#!/bin/sh\nrm -rf /"),
      bytes(0x4d, 0x5a, 0x90, 0), // exécutable Windows « MZ »
      bytes(0x50, 0x4b, 0x03, 0x04), // zip
      bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), // GIF : non accepté
      new Uint8Array(0),
      bytes(0xff, 0xd8), // trop court pour un JPEG
    ]) {
      expect(sniffContentType(sample)).toBeNull();
    }
  });

  it("n'accepte un conteneur RIFF que s'il s'agit bien de WEBP", () => {
    expect(sniffContentType(Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVEfmt ")]))).toBeNull();
    expect(sniffContentType(Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0]))).toBeNull();
  });
});

describe("nom de fichier affichable", () => {
  it("retire chemins, caractères de contrôle et caractères dangereux, et borne la longueur", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFileName("a<b>c|d?.jpg")).toBe("abcd.jpg");
    expect(sanitizeFileName("évidence\u0000\u001f.png")).toBe("évidence.png");
    expect(sanitizeFileName("")).toBe("fichier");
    expect(sanitizeFileName("x".repeat(500))).toHaveLength(100);
  });
});

describe("stockage sur disque", () => {
  const dirs: string[] = [];
  const make = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "alx-storage-unit-"));
    dirs.push(dir);
    return { dir, storage: new LocalDiskStorage(dir) };
  };
  afterAll(async () => {
    for (const d of dirs) await removeDir(d, { recursive: true, force: true });
  });

  const key = "6f1c2f0e-3d62-4b8e-9d0a-0a2c8b1d5e11/0b3a5e44-5d1c-4b8b-8a10-6f2f1a7c9d22";

  it("écrit, relit et supprime ; n'écrase jamais un fichier existant", async () => {
    const { storage } = await make();
    await storage.put(key, bytes(1, 2, 3));
    expect(Array.from(await storage.get(key))).toEqual([1, 2, 3]);
    await expect(storage.put(key, bytes(9))).rejects.toThrow();
    expect(Array.from(await storage.get(key))).toEqual([1, 2, 3]);
    await storage.remove(key);
    await expect(storage.get(key)).rejects.toThrow();
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });

  it("refuse toute clé qui n'est pas « uuid/uuid » (pas de traversée de dossier)", async () => {
    const { storage, dir } = await make();
    for (const bad of ["../../etc/passwd", "/etc/passwd", "a/b", `${key}/../x`, `..\\${key}`, "", `${key}.jpg`, "x".repeat(300)]) {
      await expect(storage.put(bad, bytes(1)), bad).rejects.toThrow();
      await expect(storage.get(bad), bad).rejects.toThrow();
    }
    expect(await readdir(dir)).toEqual([]);
    expect(STORAGE_KEY_PATTERN.test(key)).toBe(true);
  });
});
