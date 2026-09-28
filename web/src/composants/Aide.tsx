// Le « i » de chaque champ (règle du projet) : l'aide s'ouvre PAR-DESSUS, elle ne pousse rien sous
// le curseur.
import { Popover } from '@base-ui-components/react/popover';
import { titre } from '../langue.ts';

export function Aide({ texte }: { texte: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={titre('ecran.aide')}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-doux hover:bg-accent-pale focus-visible:outline-2 focus-visible:outline-accent">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-trait">i</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} className="z-50">
          <Popover.Popup className="max-w-72 rounded-lg border border-trait bg-surface p-3 text-sm text-encre shadow-lg">{texte}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
