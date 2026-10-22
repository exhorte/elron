import { describe, expect, it } from "vitest";
import {
  ACTOR_ROLES,
  CUSTODY_STATUSES,
  NOTE_REQUIRED_FOR,
  SHIPMENT_STATUSES,
  STATUS_LABELS_FR,
  TRANSITIONS,
  allowedTargets,
  canTransition,
  isKnownTransition,
  isTerminal,
  type ActorRole,
  type ShipmentStatus,
} from "@/domain/workflow";

describe("table de transitions", () => {
  it("n'autorise que les transitions déclarées (aucune transition arbitraire)", () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        for (const role of ACTOR_ROLES) {
          const declared = (TRANSITIONS[from][to] ?? []).includes(role);
          expect(canTransition(from, to, role), `${from}→${to} (${role})`).toBe(declared);
        }
      }
    }
  });

  it("interdit les transitions vers soi-même", () => {
    for (const s of SHIPMENT_STATUSES) expect(isKnownTransition(s, s)).toBe(false);
  });

  it("référence uniquement des statuts et rôles connus", () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const [to, roles] of Object.entries(TRANSITIONS[from])) {
        expect(SHIPMENT_STATUSES).toContain(to);
        for (const r of roles!) expect(ACTOR_ROLES).toContain(r);
        expect(roles!.length).toBeGreaterThan(0);
      }
    }
  });

  it("n'a que RETURNED et CANCELLED comme états terminaux", () => {
    const terminals = SHIPMENT_STATUSES.filter(isTerminal);
    expect(terminals.sort()).toEqual(["CANCELLED", "RETURNED"]);
  });

  it("permet d'atteindre tous les états depuis ACCEPTED", () => {
    const seen = new Set<ShipmentStatus>(["ACCEPTED"]);
    const queue: ShipmentStatus[] = ["ACCEPTED"];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of Object.keys(TRANSITIONS[current]) as ShipmentStatus[]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...SHIPMENT_STATUSES].sort());
  });

  it("depuis tout état non terminal, un terminal reste atteignable", () => {
    const reachesTerminal = (start: ShipmentStatus): boolean => {
      const seen = new Set<ShipmentStatus>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (isTerminal(cur)) return true;
        for (const nxt of Object.keys(TRANSITIONS[cur]) as ShipmentStatus[]) {
          if (!seen.has(nxt)) {
            seen.add(nxt);
            queue.push(nxt);
          }
        }
      }
      return false;
    };
    for (const s of SHIPMENT_STATUSES) expect(reachesTerminal(s), s).toBe(true);
  });
});

describe("règles par rôle", () => {
  const path: Array<[ShipmentStatus, ShipmentStatus]> = [
    ["ACCEPTED", "HANDED_OVER"],
    ["HANDED_OVER", "IN_TRANSIT"],
    ["IN_TRANSIT", "ARRIVED"],
    ["ARRIVED", "OUT_FOR_DELIVERY"],
    ["OUT_FOR_DELIVERY", "DELIVERED"],
  ];

  it("le parcours nominal est réservé au transporteur", () => {
    for (const [from, to] of path) {
      expect(canTransition(from, to, "provider"), `${from}→${to}`).toBe(true);
      expect(canTransition(from, to, "sender"), `${from}→${to} sender`).toBe(false);
    }
  });

  it("l'expéditeur ne peut pas déclarer la prise en charge, le transit ou l'arrivée", () => {
    expect(canTransition("ACCEPTED", "HANDED_OVER", "sender")).toBe(false);
    expect(canTransition("HANDED_OVER", "IN_TRANSIT", "sender")).toBe(false);
    expect(canTransition("IN_TRANSIT", "ARRIVED", "sender")).toBe(false);
  });

  it("n'autorise pas de saut d'étape", () => {
    expect(isKnownTransition("ACCEPTED", "DELIVERED")).toBe(false);
    expect(isKnownTransition("ACCEPTED", "IN_TRANSIT")).toBe(false);
    expect(isKnownTransition("HANDED_OVER", "ARRIVED")).toBe(false);
    expect(isKnownTransition("IN_TRANSIT", "DELIVERED")).toBe(false);
  });

  it("n'autorise jamais le retour en arrière", () => {
    expect(isKnownTransition("DELIVERED", "IN_TRANSIT")).toBe(false);
    expect(isKnownTransition("IN_TRANSIT", "ACCEPTED")).toBe(false);
    expect(isKnownTransition("CANCELLED", "ACCEPTED")).toBe(false);
    expect(isKnownTransition("RETURNED", "DELIVERY_FAILED")).toBe(false);
  });

  it("l'annulation n'est possible qu'avant la remise au transporteur", () => {
    for (const s of SHIPMENT_STATUSES) {
      const canCancelNormally = canTransition(s, "CANCELLED", "sender") || canTransition(s, "CANCELLED", "provider");
      expect(canCancelNormally, s).toBe(s === "ACCEPTED");
    }
  });

  it("seul l'opérateur résout un litige", () => {
    for (const target of ["DELIVERED", "RETURNED", "LOST", "DAMAGED", "CANCELLED"] as const) {
      expect(canTransition("DISPUTED", target, "operator")).toBe(true);
      expect(canTransition("DISPUTED", target, "sender")).toBe(false);
      expect(canTransition("DISPUTED", target, "provider")).toBe(false);
    }
  });

  it("un colis livré ne peut être contesté que par l'expéditeur ou l'opérateur", () => {
    expect(canTransition("DELIVERED", "DISPUTED", "sender")).toBe(true);
    expect(canTransition("DELIVERED", "DISPUTED", "operator")).toBe(true);
    expect(canTransition("DELIVERED", "DISPUTED", "provider")).toBe(false);
  });

  it("allowedTargets reflète la table", () => {
    expect(allowedTargets("ACCEPTED", "provider").sort()).toEqual(["CANCELLED", "DISPUTED", "HANDED_OVER"]);
    expect(allowedTargets("ACCEPTED", "sender").sort()).toEqual(["CANCELLED", "DISPUTED"]);
    expect(allowedTargets("CANCELLED", "operator")).toEqual([]);
  });

  it("exige une justification pour les états d'exception", () => {
    for (const s of ["CANCELLED", "DELIVERY_FAILED", "DAMAGED", "LOST", "DISPUTED"] as ShipmentStatus[]) {
      expect(NOTE_REQUIRED_FOR.has(s)).toBe(true);
    }
    expect(NOTE_REQUIRED_FOR.has("IN_TRANSIT")).toBe(false);
  });

  it("définit un libellé pour chaque statut et une garde pour les états en transit", () => {
    for (const s of SHIPMENT_STATUSES) expect(STATUS_LABELS_FR[s].length).toBeGreaterThan(3);
    expect(CUSTODY_STATUSES.has("IN_TRANSIT")).toBe(true);
    expect(CUSTODY_STATUSES.has("ACCEPTED")).toBe(false);
  });

  it("chaque rôle de la liste existe", () => {
    const roles: ActorRole[] = [...ACTOR_ROLES];
    expect(roles).toContain("operator");
  });
});
