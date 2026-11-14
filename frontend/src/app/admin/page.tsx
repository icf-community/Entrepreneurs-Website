import Link from "next/link";
import { pendingCounts } from "@/lib/data/admin";
import SignOutButton from "./SignOutButton";
import IngestionToggle from "./IngestionToggle";
import { getIngestionStatus } from "./actions";
import { requireAdminPage } from "@/lib/auth/guard";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Entry } from "@/components/ui/Entry";
import { PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Section } from "@/components/ui/Section";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { Icon } from "@/design-system/icons/Icon";
import type { IconName } from "@/design-system/icons/names";
import { Page } from "@/components/ui/Page";

// The control room: what is waiting for a person (a ruled sheet of counts, each
// one a way in, lit only where something is waiting), the one switch that stops
// new AI spend, and the doors to everything else an admin does.
export default async function AdminPage() {
  const { supabase } = await requireAdminPage();

  const [counts, ingestionStatus] = await Promise.all([
    pendingCounts(supabase),
    getIngestionStatus(),
  ]);
  const totalPending = counts.total;

  return (
    <Page as="main">
      <PageHead
        context="Admin"
        title="Foundry control panel"
        lede={
          totalPending > 0 ? (
            <Badge tone="lit" dot>{totalPending} awaiting review</Badge>
          ) : (
            <Badge>Queues clear</Badge>
          )
        }
        actions={
          <>
            <ButtonLink href="/members" variant="ghost" size="sm" leading={<Icon name="arrow-left" size={18} />}>
              {/* the arrow is drawn; the character stays in the accessible name, as it always was */}
              <span className="sr-only">← </span>Back to site
            </ButtonLink>
            <SignOutButton />
          </>
        }
      />

      <div className="lm-sections mt-10">
        <section aria-label="Review queues">
          <StatGrid min="sm">
            <QueueStat
              href="/admin/users"
              title="Pending alumni profiles"
              count={counts.profiles}
              hint="Manual verification"
            />
            <QueueStat
              href="/admin/opportunities"
              title="Pending opportunities"
              count={counts.opportunities}
              hint="Review queue"
            />
            <QueueStat
              href="/admin/events"
              title="Pending events"
              count={counts.events}
              hint="Review queue"
            />
            <QueueStat
              href="/admin/vcs"
              title="Pending VCs / grants"
              count={counts.vcs}
              hint="Review queue"
            />
            <QueueStat
              href="/admin/edits"
              title="Proposed changes"
              count={counts.edits}
              hint="Edits to live listings"
            />
          </StatGrid>
        </section>

        <IngestionToggle
          initial={
            ingestionStatus.ok
              ? ingestionStatus.data
              : { enabled: true, lastChangedAt: null, lastChangedBy: null }
          }
        />

        <Section
          rule
          title="Quick create"
          description="Publish directly without going through the approval queue."
        >
          <div className="flex flex-wrap gap-3">
            <CreateLink href="/admin/opportunities/new" label="Opportunity" />
            <CreateLink href="/admin/events/new" label="Event" />
            <CreateLink href="/admin/vcs/new" label="VC / grant" />
          </div>
        </Section>

        <Section
          rule
          title="Community management"
          description="Search the full membership and remove accounts. Use the graduate cleanup once a year to roll out current students whose graduation year has passed."
        >
          <Panel className="p-2">
            <ul className="grid sm:grid-cols-2">
              <DoorEntry href="/admin/members" icon="members" name="Member directory" aside="search + delete" />
              <DoorEntry href="/admin/graduates" icon="user-check" name="Graduate cleanup" />
              <DoorEntry href="/admin/reports" icon="flag" name="Reported posts" aside="moderation queue" />
              <DoorEntry href="/admin/connections" icon="connections" name="Connections" aside="reports, throttles, pause" />
              <DoorEntry href="/admin/banner" icon="notifications" name="Site banner" aside="tell members about an outage" />
              <DoorEntry href="/admin/ai" icon="foundry-ai" name="AI" aside="health, limits, job audiences" />
            </ul>
          </Panel>
        </Section>
      </div>
    </Page>
  );
}

// One count and the queue it opens. The whole cell is the link (the title's own
// link stretches over it), so the accessible name stays the title and the count
// is read in its place in the list. A queue with something waiting is lit: the
// number in warm ink and a point of light before the name; an empty one is quiet.
function QueueStat({ href, title, count, hint }: { href: string; title: string; count: number; hint: string }) {
  const waiting = count > 0;
  return (
    <Stat
      className="group transition-colors hover:bg-tint-1"
      tone={waiting ? "lit" : "default"}
      label={
        <Link
          href={href}
          className="text-inherit no-underline after:absolute after:inset-0 after:content-[''] group-hover:text-text-primary"
        >
          {waiting && <span aria-hidden className="mr-2 inline-block size-1.5 rounded-full bg-lit align-middle" />}
          {title}
        </Link>
      }
      value={waiting ? count : <span className="text-text-muted">0</span>}
      hint={hint}
    />
  );
}

// "+ Opportunity": the plus is drawn, and stays in the accessible name as text.
function CreateLink({ href, label }: { href: string; label: string }) {
  return (
    <ButtonLink href={href} variant="ghost" size="md" leading={<Icon name="plus" size={18} />}>
      <span className="sr-only">+ </span>
      {label}
    </ButtonLink>
  );
}

// A door to another admin page: the page's name, what it is for in a quieter ink
// (the whole label stays one run of text, "Member directory · search + delete").
function DoorEntry({ href, icon, name, aside }: { href: string; icon: IconName; name: string; aside?: string }) {
  return (
    <Entry
      as="li"
      href={href}
      glyph={<Icon name={icon} size={20} />}
      title={
        <>
          {name}
          {aside && <span className="text-text-muted"> · {aside}</span>}
        </>
      }
    />
  );
}
