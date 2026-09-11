/**
 * Zugangswort des Social-Media-Teams.
 *
 * Ein gemeinsames Wort, kein Konto-System. Neun Leute, die denselben Flyer
 * bearbeiten, brauchen keine Benutzerverwaltung — und ein Konto pro Person
 * wuerde personenbezogene Daten erzeugen, die es heute nicht gibt.
 *
 * Bewusst `sessionStorage`, nicht `localStorage`: das Wort ueberlebt einen
 * Reload, aber nicht das Schliessen des Browsers. Auf einem geteilten Rechner
 * im Gemeinderaum ist das der Unterschied zwischen „kurz eingeloggt" und
 * „dauerhaft offen".
 *
 * Gespiegelt vom Muster in `components/ProjectHistory.tsx` — dort liegt der
 * Historie-Token nach derselben Logik.
 */

const TEAM_TOKEN_STORAGE_KEY = 'tyrannus-team-token';
export const TEAM_TOKEN_HEADER = 'X-Team-Token';

/** In-Memory-Spiegel: wirkt auch, wenn der Browser Storage blockiert. */
let memoryToken = '';

export function readTeamToken(): string {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = sessionStorage.getItem(TEAM_TOKEN_STORAGE_KEY) || '';
  } catch {
    // Privater Modus oder gehaertete Einstellungen. Der Speicher im Arbeitsspeicher reicht.
  }
  return memoryToken;
}

export function writeTeamToken(token: string): void {
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TEAM_TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TEAM_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Siehe oben — kein Grund, den Ablauf abzubrechen.
  }
}

/**
 * Header fuer die kostenpflichtigen Routen.
 *
 * Leeres Wort erzeugt bewusst KEINEN Header: dann antwortet der Server mit 401
 * und die Oberflaeche zeigt das Tor, statt einen leeren Wert zu vergleichen.
 */
export function teamAuthHeaders(): Record<string, string> {
  const token = readTeamToken().trim();
  return token ? { [TEAM_TOKEN_HEADER]: token } : {};
}
