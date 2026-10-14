import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { loadDashboardPageData } from "@/lib/dashboard-data";
import { H25_FILE } from "@/lib/real-data-files";
import Dashboard from "../dashboard";

// Reads local data files at request time; nothing here calls PayPal or Gemini.
export const dynamic = "force-dynamic";

export default function Home() {
  // The BDEW H25 profile is not redistributed with the repository; without it this older overview cannot be built.
  if (!existsSync(path.join(process.cwd(), "src", "data", H25_FILE))) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <h1 className="text-2xl font-bold">Energy overview needs one public data file</h1>
        <p>
          This earlier three-neighbour overview uses the BDEW H25 load profile, which is not redistributed with the repository.
          Run <code>npm run fetch-data:h25</code> in <code>paypal-solar</code> and reload. It downloads only that public profile.
        </p>
        <p>
          The operator desk does not need it: <Link className="text-sky-700 underline" href="/coop?source=evidence">open the operator desk</Link>.
        </p>
      </main>
    );
  }
  return <Dashboard data={loadDashboardPageData()} />;
}
