"use client";

import dynamic from "next/dynamic";

const TraceTool = dynamic(() => import("./TraceTool.client"), { ssr: false });

export default function Page() {
  return <TraceTool />;
}
