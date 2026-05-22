"use client";
import dynamic from "next/dynamic";

const HeroScene = dynamic(() => import("./HeroScene"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[420px] md:h-[500px] lg:h-[560px] bg-gradient-to-br from-primary/10 to-accent/10 animate-pulse rounded-2xl" />
  ),
});

export default function HeroSceneWrapper() {
  return <HeroScene />;
}
