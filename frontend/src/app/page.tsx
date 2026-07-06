import { Suspense } from "react";
import SearchPage from "@/components/SearchPage";

export default function Home() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
