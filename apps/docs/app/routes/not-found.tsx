import { baseOptions } from "@/lib/layout.shared";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Page not found · WebFrost" }];
}

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <h1 className="mb-2 text-xl font-bold">Page not found</h1>
        <p className="mb-6 text-sm text-fd-muted-foreground">
          This address does not match any page. It may have moved when the docs were reorganised.
        </p>
        <Link
          className="rounded-full bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground"
          to="/docs"
        >
          Back to the documentation
        </Link>
      </div>
    </HomeLayout>
  );
}
