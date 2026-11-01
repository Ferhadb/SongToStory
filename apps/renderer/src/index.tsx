import React from "react";
import { Composition, registerRoot } from "remotion";
import { Story, durationFramesOf, type Project, type StoryProps } from "@mss/compositions";

const Root: React.FC = () => (
  <Composition
    id="Story"
    component={Story as unknown as React.FC<Record<string, unknown>>}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{} as Record<string, unknown>}
    calculateMetadata={({ props }) => {
      const p = (props as unknown as StoryProps).project as Project;
      const { w, h } = { "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 }, "4:5": { w: 1080, h: 1350 }, "16:9": { w: 1920, h: 1080 } }[p.canvas.aspect];
      return { width: w, height: h, fps: p.canvas.fps, durationInFrames: durationFramesOf(p) };
    }}
  />
);

registerRoot(Root);
