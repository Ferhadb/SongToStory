import CreateFlow from "./CreateFlow";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 py-24">
      <h1 className="max-w-xl text-center font-serif text-5xl leading-tight tracking-tight">
        Turn a song into a story.
      </h1>
      <CreateFlow />
    </main>
  );
}
