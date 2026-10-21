import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className="font-mono">
          theme preview
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight">DocChat</h1>
        <p className="text-lg text-muted-foreground">
          Upload documents, ask questions, and get answers with cited sources.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sample answer</CardTitle>
        </CardHeader>
        <CardContent className="leading-7">
          Refunds are processed within 14 days of the request{" "}
          <span className="inline-flex items-center rounded-sm bg-highlight px-1.5 py-0.5 font-mono text-xs text-highlight-foreground">
            [1] refund-policy.pdf · p. 3
          </span>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button>Upload document</Button>
        <Button variant="outline">Secondary</Button>
      </div>
    </main>
  );
}
