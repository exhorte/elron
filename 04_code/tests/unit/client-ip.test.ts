import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/http";

const req = (xff?: string) => new Request("http://localhost/", { headers: xff ? { "x-forwarded-for": xff } : {} });
const env = (hops?: string) => (hops === undefined ? {} : { TRUSTED_PROXY_HOPS: hops }) as unknown as NodeJS.ProcessEnv;

describe("clientIp (X-Forwarded-For n'est jamais cru sans proxy de confiance)", () => {
  it("ignore l'en-tête sans proxy de confiance (valeur par défaut)", () => {
    expect(clientIp(req("203.0.113.9"), env())).toBe("unknown");
    expect(clientIp(req("203.0.113.9"), env("0"))).toBe("unknown");
    expect(clientIp(req("203.0.113.9"), env("abc"))).toBe("unknown");
    expect(clientIp(req("203.0.113.9"), env("-1"))).toBe("unknown");
  });

  it("prend l'entrée ajoutée par le proxy de confiance (la plus à droite), pas celle que le client peut forger", () => {
    // le client envoie « 1.2.3.4 », le proxy de confiance ajoute la vraie IP à droite
    expect(clientIp(req("1.2.3.4, 203.0.113.9"), env("1"))).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9"), env("1"))).toBe("203.0.113.9");
  });

  it("gère plusieurs proxys de confiance et l'IPv6", () => {
    expect(clientIp(req("9.9.9.9, 203.0.113.9, 10.0.0.2"), env("2"))).toBe("203.0.113.9");
    expect(clientIp(req("2001:db8::1"), env("1"))).toBe("2001:db8::1");
  });

  it("retombe sur « unknown » si l'en-tête est absent, trop court ou invalide", () => {
    expect(clientIp(req(), env("1"))).toBe("unknown");
    expect(clientIp(req("203.0.113.9"), env("2"))).toBe("unknown");
    expect(clientIp(req("<script>alert(1)</script>"), env("1"))).toBe("unknown");
    expect(clientIp(req("a".repeat(100)), env("1"))).toBe("unknown");
  });
});
