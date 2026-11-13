"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Field, FieldError } from "@/components/forms/Field";
import { labelCls } from "@/components/forms/styles";
import { Switch } from "@/components/forms/Switch";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { Textarea } from "@/components/ui/Textarea";
import { Icon } from "@/design-system/icons/Icon";
import type { AiSettings, Concept } from "@/lib/ai/types";
import { previewMyProjection, saveAiSettings, type ProjectionPreviewItem } from "./actions";
import { SettingsSection } from "./SettingsSection";

// ════════════════════════════════════════════════════════════════════
// AI matching choices (AI-plan §1, §6, §12). Three separate permissions,
// each off until the member turns it on: being found by recruiters, being
// suggested to members building their network, and letting recruiters
// see lines quoted from your CV. Turning one off removes you from that
// search at once. One sentence each, with the detail on /ai-notice (F22).
// ════════════════════════════════════════════════════════════════════

const ROLE_TYPES = [
  ["internship", "Internship"], ["placement", "Placement"], ["graduate", "Graduate role"],
  ["part_time", "Part-time"], ["full_time", "Full-time"], ["contract", "Contract"], ["cofounder", "Co-founder"],
] as const;
const LOCATIONS = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On site"]] as const;

export default function AiSettingsCard({ initial, concepts }: { initial: AiSettings; concepts: Concept[] }) {
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ purpose: string; items: ProjectionPreviewItem[] } | null>(null);
  const [note, setNote] = useState(initial.selfReported);

  const save = async (next: AiSettings) => {
    const before = s;
    setS(next);
    setSaving(true);
    setError(null);
    try {
      const res = await saveAiSettings(next);
      if (!res.ok) { setS(before); setError(res.error); }
    } catch {
      setS(before);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async (purpose: "recruiter" | "network" | "self") => {
    const res = await previewMyProjection(purpose);
    if (res.ok) setPreview({ purpose, items: res.data });
    else setError(res.error);
  };

  return (
    <SettingsSection
      id="ai"
      title="AI matching"
      description={
        <>
          Each choice is off until you turn it on.{" "}
          <Link href="/ai-notice" className="underline underline-offset-2">How AI search uses your profile</Link>
        </>
      }
    >
      {/* The four permissions on one ruled sheet. */}
      <div className="grid divide-y divide-border-subtle">
        <div className="pb-5">
          <Switch id="ai-recruiter" checked={s.recruiterDiscoverable} busy={saving}
            onChange={(v) => save({ ...s, recruiterDiscoverable: v })}
            label="Let recruiters find me" hint="Members who posted a job can see you in AI candidate search." />
        </div>
        <div className="py-5">
          <Switch id="ai-network" checked={s.networkDiscoverable} busy={saving}
            onChange={(v) => save({ ...s, networkDiscoverable: v })}
            label="Suggest me to members building their network" hint="Members can find you by shared skills and interests." />
        </div>
        <div className="py-5">
          <Switch id="ai-evidence" checked={s.evidenceSharing} busy={saving}
            onChange={(v) => save({ ...s, evidenceSharing: v })}
            label="Show recruiters lines from my CV" hint="Up to two short lines, only to recruiters who found you." />
        </div>
        <div className="pt-5">
          <Switch id="ai-memory" checked={s.useChatMemory} busy={saving}
            onChange={(v) => save({ ...s, useChatMemory: v })}
            label="Use my recent searches to understand new ones" hint="Your own searches from the last 7 days only." />
        </div>
      </div>

      <div className="mt-8 grid gap-7 border-t border-border-subtle pt-8">
        <TopicPicker label="I can help with" concepts={concepts} value={s.networkOffers} disabled={saving}
          onChange={(v) => save({ ...s, networkOffers: v })} />
        <TopicPicker label="I'd like help with" concepts={concepts} value={s.networkSeeks} disabled={saving}
          onChange={(v) => save({ ...s, networkSeeks: v })} />
        <Checks label="Jobs I'm interested in" options={ROLE_TYPES} value={s.prefRoleTypes} disabled={saving}
          onChange={(v) => save({ ...s, prefRoleTypes: v })} />
        <Checks label="Where I'd like to work" options={LOCATIONS} value={s.prefLocationTypes} disabled={saving}
          onChange={(v) => save({ ...s, prefLocationTypes: v })} />
        <div>
          <label htmlFor="ai-self-reported" className={labelCls}>Projects and experience</label>
          <p id="ai-self-reported-note" className="mb-2 mt-0.5 text-small text-text-muted">Useful if you haven&apos;t uploaded a CV. Shown as self-reported.</p>
          <Textarea id="ai-self-reported" rows={4} maxLength={1200} value={note} onChange={(e) => setNote(e.target.value)}
            aria-describedby="ai-self-reported-note" className="resize-none" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-small text-text-muted data">{note.length}/1200</span>
            <Button size="sm" variant="ghost" loading={saving} disabled={note === s.selfReported}
              onClick={() => save({ ...s, selfReported: note })}>Save</Button>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-8">
        <span className="w-full text-small text-text-muted">See exactly what AI search uses:</span>
        <Button variant="ghost" size="sm" onClick={() => showPreview("self")}>For my job matches</Button>
        {s.recruiterDiscoverable && <Button variant="ghost" size="sm" onClick={() => showPreview("recruiter")}>What recruiters search</Button>}
        {s.networkDiscoverable && <Button variant="ghost" size="sm" onClick={() => showPreview("network")}>What members search</Button>}
      </div>
      {preview && (
        <Panel tone="inset" size="sm" className="mt-4 p-4">
          {preview.items.length === 0 ? (
            <p className="text-body text-text-muted">Nothing yet. It updates a few minutes after you change your profile.</p>
          ) : (
            <ul className="grid gap-2">
              {preview.items.map((item) => (
                <li key={`${item.kind}:${item.text}`} className="text-body text-text-secondary">
                  {item.text}{item.fromCv && <span className="text-text-muted"> · from your CV</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <FieldError>{error ?? undefined}</FieldError>
    </SettingsSection>
  );
}

function TopicPicker({
  label, concepts, value, disabled, onChange,
}: { label: string; concepts: Concept[]; value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState("");
  const byslug = useMemo(() => new Map(concepts.map((c) => [c.slug, c])), [concepts]);
  const matches = query.trim().length < 2 ? [] : concepts
    // react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply
    .filter((c) => !value.includes(c.slug) && c.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  const inputId = `topic-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={inputId} className={labelCls}>{label}</label>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((slug) => {
            const name = byslug.get(slug)?.label ?? slug;
            return (
              <li key={slug}>
                <Chip lit removable size="sm" disabled={disabled} aria-label={`Remove ${name}`}
                  onClick={() => onChange(value.filter((v) => v !== slug))}>{name}</Chip>
              </li>
            );
          })}
        </ul>
      )}
      {value.length < 10 && (
        <>
          <Input id={inputId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics"
            className="mt-2" />
          {matches.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {matches.map((c) => (
                <li key={c.slug}>
                  <Chip size="sm" disabled={disabled}
                    onClick={() => { onChange([...value, c.slug]); setQuery(""); }}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="plus" size={14} />
                      <span className="sr-only">+ </span>
                      {c.label}
                    </span>
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Checks({
  label, options, value, disabled, onChange,
}: {
  label: string;
  options: readonly (readonly [string, string])[];
  value: string[];
  disabled: boolean;
  onChange: (v: string[]) => void;
}) {
  return (
    <Field group label={label}>
      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        {options.map(([v, l]) => (
          /* react-doctor-disable-next-line js-set-map-lookups -- array is provably bounded to a tiny fixed size (not user/data-scaled); O(n²) concern doesn't apply */
          <Checkbox key={v} className="py-2.5" label={l} disabled={disabled} checked={value.includes(v)}
            onChange={(e) => onChange(e.target.checked ? [...value, v] : value.filter((x) => x !== v))} />
        ))}
      </div>
    </Field>
  );
}
