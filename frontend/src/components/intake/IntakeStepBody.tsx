import type { DirectoryMember } from "@/lib/data/directory";
import type { StepId } from "@/lib/intake/steps";
import {
  CvScreen,
  FaceScreen,
  GithubScreen,
  InterestsScreen,
  SkillsScreen,
  WantScreen,
  WhereScreen,
  YoureInScreen,
  type ScreenProps,
} from "./screens";

/** The per-step screen body — extracted out of IntakeFlow's render
 *  (structural only, no behavior change) to keep that component's size
 *  and complexity down. */
export function IntakeStepBody({
  step,
  screenProps,
  matches,
}: {
  step: StepId;
  screenProps: ScreenProps;
  matches: DirectoryMember[];
}) {
  switch (step) {
    case "face":
      return <FaceScreen {...screenProps} />;
    case "youre-in":
      return <YoureInScreen {...screenProps} matches={matches} />;
    case "cv":
      return <CvScreen {...screenProps} />;
    case "github":
      return <GithubScreen {...screenProps} />;
    case "skills":
      return <SkillsScreen {...screenProps} />;
    case "interests":
      return <InterestsScreen {...screenProps} />;
    case "where":
      return <WhereScreen {...screenProps} />;
    case "want":
      return <WantScreen {...screenProps} />;
  }
}
