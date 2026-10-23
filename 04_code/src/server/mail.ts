import { isProduction } from "@/config/app";

/**
 * Interface d'envoi d'e-mails. AUCUN fournisseur réel n'est intégré (décision humaine P0.4) :
 *  - `console`  : affiche le message dans les journaux du serveur — développement uniquement, REFUSÉ en production
 *                 (le lien de réinitialisation y apparaîtrait en clair) ;
 *  - `disabled` : n'envoie rien (défaut en production tant qu'aucun fournisseur n'est branché).
 * `operational` vaut `false` pour ces deux adaptateurs : l'interface le dit honnêtement à l'utilisateur.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailAdapter {
  readonly name: string;
  /** `true` seulement si un vrai fournisseur délivre les messages. */
  readonly operational: boolean;
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailAdapter implements MailAdapter {
  readonly name = "console";
  readonly operational = false;
  async send(message: MailMessage): Promise<void> {
    console.info(`[mail:console] à ${message.to} — ${message.subject}\n${message.text}`);
  }
}

class DisabledMailAdapter implements MailAdapter {
  readonly name = "disabled";
  readonly operational = false;
  async send(): Promise<void> {
    // volontairement vide : rien n'est envoyé
  }
}

/** Adaptateur en mémoire pour les tests : conserve les messages envoyés. */
export class MemoryMailAdapter implements MailAdapter {
  readonly name = "memory";
  readonly sent: MailMessage[] = [];
  constructor(
    readonly operational = true,
    private readonly failWith?: Error,
  ) {}
  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
}

let override: MailAdapter | null = null;

/** Réservé aux tests : impose un adaptateur (null = retour à la configuration d'environnement). */
export function setMailAdapterForTests(adapter: MailAdapter | null): void {
  override = adapter;
}

export function getMailAdapter(env: NodeJS.ProcessEnv = process.env): MailAdapter {
  if (override) return override;
  const transport = env.MAIL_TRANSPORT ?? (isProduction(env) ? "disabled" : "console");
  if (transport === "console") {
    if (isProduction(env)) throw new Error("MAIL_TRANSPORT=console est interdit en production (les liens de réinitialisation seraient journalisés).");
    return new ConsoleMailAdapter();
  }
  if (transport === "disabled") return new DisabledMailAdapter();
  throw new Error(`MAIL_TRANSPORT inconnu : ${transport} (valeurs : console, disabled)`);
}
