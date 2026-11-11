#!/usr/bin/env bash
# (1.356.0) Le miroir d'Ubuntu des machines de GitHub (azure.archive.ubuntu.com) ne se résolvait plus le 11/11/2026 : six
# envois de suite sont tombés sur l'installation du navigateur des tests — trente minutes chacun, trois essais d'apt —
# sans qu'un seul test ait tourné. Quand ce nom ne se résout pas, apt passe aux miroirs officiels : on le retire de la
# liste des miroirs (/etc/apt/apt-mirrors.txt, que lisent les sources des machines de GitHub) et des sources écrites en
# clair. Quand il se résout, rien ne change.
set -u
if getent hosts azure.archive.ubuntu.com >/dev/null 2>&1; then exit 0; fi
echo "::warning title=Miroir d'Ubuntu::azure.archive.ubuntu.com ne se résout pas : apt passe aux miroirs officiels."
for f in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] || continue
  sudo sed -i -e '/azure\.archive\.ubuntu\.com.*priority:/d' -e 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' "$f"
done
exit 0
