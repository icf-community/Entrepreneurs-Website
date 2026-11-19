import { Fragment } from "react";

/** A heading set on several lines: each line is a block, and a plain space between them keeps the heading one sentence for assistive technology. */
export function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={line}>
          {i > 0 && " "}
          <span className="ln">{line}</span>
        </Fragment>
      ))}
    </>
  );
}
