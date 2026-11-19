import { useEffect, useState } from "react";
import { FolderCog, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button, Field, Input } from "@/components/ui/controls";
import { SERVER_COLORS, DEFAULT_GROUP_COLOR } from "@/lib/colors";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";

function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      {SERVER_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          aria-label={`${t("useColor")} ${color}`}
          className={cn(
            "h-4 w-4 rounded-full border transition-transform hover:scale-110",
            value.toLowerCase() === color.toLowerCase()
              ? "border-white ring-2 ring-brand"
              : "border-black/20",
          )}
          style={{ background: color }}
        />
      ))}
    </div>
  );
}

/** Create, recolour, rename and delete server groups. */
export function GroupDialog() {
  const t = useT();
  const open = useApp((s) => s.ui.groupsOpen);
  const setUi = useApp((s) => s.setUi);
  const groups = useApp((s) => s.groups);
  const profiles = useApp((s) => s.profiles);
  const saveGroup = useApp((s) => s.saveGroup);
  const deleteGroup = useApp((s) => s.deleteGroup);
  const askConfirm = useApp((s) => s.askConfirm);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (open) {
      setNames(Object.fromEntries(groups.map((group) => [group.name, group.name])));
      setNewName("");
    }
  }, [open, groups]);

  const close = () => setUi({ groupsOpen: false });

  const add = async () => {
    const name = newName.trim();
    if (!name || groups.some((group) => group.name === name)) return;
    const nextPosition = groups.reduce((max, group) => Math.max(max, group.position), -1) + 1;
    await saveGroup({
      name,
      color: SERVER_COLORS[groups.length % SERVER_COLORS.length],
      position: nextPosition,
    });
    setNewName("");
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? close() : undefined)}>
      <DialogContent size="md">
        <DialogHeader
          title={t("groupsTitle")}
          description={t("groupsBody")}
          icon={<FolderCog className="h-4 w-4" />}
        />
        <DialogBody className="space-y-2">
          {groups.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px] text-mute">
              {t("groupsEmpty")}
            </p>
          ) : null}

          {groups.map((group) => {
            const count = profiles.filter((p) => p.groupName === group.name).length;
            const draftName = names[group.name] ?? group.name;
            return (
              <div
                key={group.name}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1.5"
              >
                <span
                  className="h-5 w-1 shrink-0 rounded-full"
                  style={{ background: group.color || DEFAULT_GROUP_COLOR }}
                />
                <Input
                  value={draftName}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [group.name]: event.target.value }))
                  }
                  onBlur={() => {
                    const name = draftName.trim();
                    if (!name || name === group.name) return;
                    if (groups.some((item) => item.name === name)) return;
                    void saveGroup({ ...group, name }, group.name);
                  }}
                  className="h-7 w-[150px] text-[11.5px]"
                  spellCheck={false}
                />
                <span className="text-[10.5px] text-mute">{count} {t("serversCount")}</span>
                <div className="flex-1" />
                <Swatches
                  value={group.color || DEFAULT_GROUP_COLOR}
                  onChange={(color) => void saveGroup({ ...group, color })}
                />
                <button
                  onClick={() => {
                    askConfirm({
                      title: `${t("deleteGroupTitle")} “${group.name}”?`,
                      body:
                        count > 0
                          ? `${count} ${t("serversCount")} ${t("deleteGroupMove")}`
                          : t("deleteGroupBodyEmpty"),
                      danger: true,
                      confirmLabel: t("deleteGroupBtn"),
                      action: () => deleteGroup(group.name),
                    });
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-mute hover:bg-surface-3 hover:text-danger"
                  aria-label={t("deleteGroupAria")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <Field label={t("newGroup")}>
            <div className="flex items-center gap-1.5">
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add();
                }}
                placeholder={t("groupPlaceholder")}
                className="h-7 text-[11.5px]"
                spellCheck={false}
              />
              <Button size="sm" variant="subtle" disabled={!newName.trim()} onClick={() => void add()}>
                <Plus className="h-3.5 w-3.5" /> {t("add")}
              </Button>
            </div>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="brand" onClick={close}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
