// Un clic qui dit pourquoi il n'a pas pu se faire (brique 108). Dans la vérification de GitHub, un clic qui
// attend en vain ne laissait lire que « waiting for locator(…) » : l'élément manquait-il, ou autre chose le
// recouvrait-il ? On ne voit pas l'écran de la CI. Le message dit donc combien d'éléments répondent, où est le
// premier, ce qui se trouve sous le doigt à sa place, et ce que l'écran montre (adresse, titre, fenêtre ouverte,
// et le texte d'une zone qu'on nomme), et ce que le test sait raconter de plus (`raconter` : l'état du serveur).
import type { Locator } from 'playwright-core';

export async function cliquer(l: Locator, zone = '', delai = 15_000, raconter?: () => Promise<string>): Promise<void> {
  try {
    await l.click({ timeout: delai });
    return;
  } catch (e) {
    const n = await l.count().catch(() => -1);
    const dessus = n > 0 ? await l.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const qui = !x ? 'rien (hors de l\'écran)' : x === el || el.contains(x) ? 'lui-même' : x.outerHTML.replace(/\s+/g, ' ').slice(0, 120);
      return `en ${Math.round(r.left)},${Math.round(r.top)}, ${Math.round(r.width)}×${Math.round(r.height)} ; sous le doigt : ${qui}`;
    }).catch(() => '') : '';
    const ecran = await l.page().evaluate((z) => {
      const net = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const fenetre = document.querySelector('#modal-root .modal');
      const zoneEl = z ? document.querySelector(z) : null;
      return [location.hash, `titre « ${net(document.querySelector('#view h1')?.textContent, 60)} »`,
        fenetre ? `fenêtre « ${net(fenetre.textContent, 80)} »` : '', zoneEl ? `${z} : « ${net((zoneEl as HTMLElement).innerText, 120)} »` : ''].filter(Boolean).join(' ; ');
    }, zone).catch(() => '?');
    const plus = raconter ? await raconter().catch((x: unknown) => `(récit impossible : ${String(x)})`) : '';
    throw new Error(`clic impossible, ${n} trouvé(s)${dessus ? ` ${dessus}` : ''} — écran : ${ecran}${plus ? ` — ${plus}` : ''}`, { cause: e });
  }
}

// Un mouchard, dans la base de test seulement (brique 108) : qui supprime un objet du dossier, et quand. En CI, un
// objet posé par un autre (l'article, le compte Konnect) manquait à la page : le récit d'un clic impossible le dit.
export async function poserMouchard(admin: { query: (q: string) => Promise<unknown> }): Promise<void> {
  await admin.query(`create table if not exists public.mouchard_suppr (instant timestamptz not null default clock_timestamp(), entreprise uuid, collection text, cle text, par uuid)`);
  await admin.query(`create or replace function public.mouchard() returns trigger language plpgsql security definer as $$
    begin insert into public.mouchard_suppr (entreprise, collection, cle, par) values (old.entreprise, old.collection, old.cle, socle.moi()); return old; end $$`);
  await admin.query('drop trigger if exists mouchard on socle.dossier_v10');
  await admin.query('create trigger mouchard after delete on socle.dossier_v10 for each row execute function public.mouchard()');
}
export async function recitObjet(admin: { query: (q: string, v: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, entreprise: string, collection: string, cle?: string): Promise<string> {
  const la = (await admin.query('select cle from socle.dossier_v10 where entreprise = $1 and collection = $2' + (cle ? ' and cle = $3' : ''), cle ? [entreprise, collection, cle] : [entreprise, collection])).rows.length;
  const parti = (await admin.query(`select m.cle, to_char(m.instant, 'HH24:MI:SS.MS') quand, coalesce(u.nom, 'personne') qui from public.mouchard_suppr m left join socle.utilisateur u on u.id = m.par
    where m.entreprise = $1 and m.collection = $2` + (cle ? ' and m.cle = $3' : ''), cle ? [entreprise, collection, cle] : [entreprise, collection])).rows;
  return `serveur : ${la} « ${collection}${cle ? `/${cle}` : ''} »${parti.length ? ` ; supprimé(s) : ${parti.map((r) => `${String(r.cle)} par ${String(r.qui)} à ${String(r.quand)}`).join(', ')}` : ' ; aucune suppression'}`;
}
