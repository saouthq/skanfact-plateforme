-- (1.325.0) La facture électronique reçue, jusqu'au comptable (décidé par délégation le 08/11/2026). Le fichier El Fatoora
-- (XML TEIF) que le fournisseur envoie à son client se joint à un message pour le cabinet, comme une photo ou un PDF : le
-- client le transmettait par courriel, la messagerie le refusait (« ni une photo ni un PDF »). Le serveur le reconnaît à son
-- en-tête et à son élément principal TEIF (serveur/achats/sorte.ts), jamais à son nom ; ni script, ni SVG, ni XHTML.
--
-- Le cabinet le lit SANS l'IA : le fichier dit tout, au millime, et rien ne sort du serveur. La lecture garde d'où elle
-- vient (`source` : 'ia' pour une photo lue par l'IA, 'teif' pour le fichier) et ce que le fichier dit de plus qu'une
-- photo (`detail` : chaque taux de TVA avec sa base, le timbre, les lignes, la signature, l'avoir, à qui il est adressé),
-- les montants en texte au millième (« 154.850 »), jamais en nombre à virgule.

alter table messagerie.fichier drop constraint fichier_type_check;
alter table messagerie.fichier add constraint fichier_type_check
  check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml'));

create or replace function messagerie.deposer(p_entreprise uuid, p_cote text, p_nom text, p_type text, p_contenu bytea, p_empreinte text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid; v uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  if p_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml') then
    perform socle.refus('seules une photo (JPEG, PNG, WebP), un PDF ou une facture électronique (XML El Fatoora) se joignent à un message');
  end if;
  if octet_length(p_contenu) = 0 or octet_length(p_contenu) > 10485760 then perform socle.refus('un fichier joint pèse dix mégaoctets au plus'); end if;
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.fichier (entreprise, cabinet, nom, type, taille, contenu, empreinte, depose_par)
  values (p_entreprise, v_cabinet, left(trim(coalesce(nullif(trim(p_nom), ''), 'fichier')), 200), p_type, octet_length(p_contenu), p_contenu, p_empreinte, socle.moi())
  returning id into v;
  return v;
end $$;

-- Le cabinet range aussi dans le classeur le fichier qu'un client lui a transmis autrement (une clé, un courriel).
alter table cabinet.document drop constraint document_type_check;
alter table cabinet.document add constraint document_type_check
  check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml'));

alter table cabinet.lecture add column source text not null default 'ia' check (source in ('ia', 'teif'));
alter table cabinet.lecture add column detail jsonb check (detail is null or jsonb_typeof(detail) = 'object');
-- Seul le fichier porte un détail : une photo lue par l'IA ne dit que le fournisseur, le numéro, la date et le total.
alter table cabinet.lecture add constraint lecture_detail_du_fichier check (detail is null or source = 'teif');
