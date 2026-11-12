# 13 · Online Safety Act — Children's Access Assessment

> **Status:** DRAFT for adoption, 12 Nov 2026. Requires sign-off at §6 **and solicitor review**
> of the §4 conclusion ([12](./12-uk-legal-gap-analysis.md) §2.2).
> **Service:** Foundry (imperialentrepreneurs.com), operated by IC Founders Ltd.
> **Why now:** every regulated user-to-user service must carry out and record a children's access
> assessment. Ofcom's deadline was 16 April 2025, or three months after a service comes into scope.
> Foundry came into scope when the Community feed launched in August 2026, so this is due now, and
> it was missing until this draft.

## 1. The two-stage test (OSA ss.35–37)

1. **Is it possible for children to access the service, or part of it?** The answer is "no" only
   if the service uses age verification or age estimation that is **highly effective** at
   preventing children from normally accessing it.
2. **If it is possible: is the child user condition met?** That is, either there is a
   **significant number** of children who are users, or the service is of a kind likely to attract
   a significant number of children. If it is met, a children's risk assessment and the
   protection-of-children duties follow.

A "child" means a person under 18.

## 2. Facts about the service

| | |
|---|---|
| Who can join | Current Imperial College London students (verified Imperial email, auto-approved); alumni and other affiliates (manual admin review) |
| Age rule | 18 or over (Terms §2). Since 12 Nov 2026 every new member ticks "I'm 18 or over" at signup, and the confirmation, Terms version and time are recorded on the account (`lib/legal.ts`). The Google sign-in notice says the same |
| Under-18s found | Account closed; they can rejoin at 18 (Terms §2, Privacy §12) |
| Who could be under 18 | Imperial admits a small number of first-year undergraduates who are 17 at the start of their first term. Alumni, postgraduates, staff, mentors and investors are adults |
| Content | Professional/startup context: jobs, events, funding listings, a 7-day feed, one-to-one connection notes |
| Public access | None; nothing is indexed |
| Marketing | Aimed at founders, students and alumni of a university. Nothing is aimed at under-18s |

## 3. Stage 1 — is access possible?

**Yes, it is possible.** The 18+ confirmation is a self-declaration, and Ofcom does not treat
self-declaration as highly effective age assurance. Imperial email verification shows enrolment,
not age. So Foundry cannot claim that children are prevented from normally accessing it.

## 4. Stage 2 — is the child user condition met?

**Draft conclusion: not met.** ⚖ Solicitor to confirm.

- **Number.** The only realistic under-18 users are Imperial first-years who are still 17. That is
  a small group within a small cohort. Every one of them turns 18 during their first year, and they
  now have to state falsely that they are 18 in order to join.
- **Ofcom reads "significant" in relative terms, not only absolute ones,** so a small number is not
  automatically insignificant. The counter-argument is that the proportion of the user base under
  18 at any moment is expected to be very low (well under 1%), and falls to zero as each cohort
  turns 18.
- **Appeal to children.** Nothing about the service — university-only membership, professional
  content, no games, no entertainment — is likely to attract children.
- **Evidence to keep.** At the start of each autumn term, record how many accounts were closed
  for being under 18 (zero is a valid record). If that number is anything more than isolated
  cases, re-run this assessment.

**If the solicitor disagrees** (the condition is met), the consequences are: a children's risk
assessment within three months; the protection-of-children codes; and the ICO Children's Code
defaults for under-18 members (high-privacy settings, Foundry AI discovery and CV-excerpt sharing
off and locked for under-18s). In that case the simpler course may be to defer approval of
student accounts until the member's 18th birthday, which needs date-of-birth collection.

## 5. Review triggers

Re-assess before the annual date if: membership opens beyond Imperial affiliates; the age rule
changes; an autumn-term check finds more than isolated under-18 accounts; a feature aimed at
pre-university students (for example school outreach) is added; or Ofcom changes its guidance on
"significant number".

## 6. Adoption

| | |
|---|---|
| **Adopted by** | ______________________ (director, IC Founders Ltd) |
| **Date** | ______________________ |
| **Solicitor review of §4** | ☐ Completed by ____________ ☐ Not yet obtained |
| **Next review due** | ______________________ (12 months, or on a §5 trigger) |

Related: [09 Illegal Content Risk Assessment](./09-osa-illegal-content-risk-assessment.md) ·
[12 UK Legal Gap Analysis](./12-uk-legal-gap-analysis.md)
