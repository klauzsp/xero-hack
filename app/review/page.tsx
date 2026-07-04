import { XeroApp } from "../xero-app";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { q } = await searchParams;

  return <XeroApp initialQuestion={typeof q === "string" ? q : ""} view="review" />;
}
