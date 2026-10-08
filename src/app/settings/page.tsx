import { AppSettingsSections } from "@/components/settings/AppSettingsSections";
import { SettingsForm } from "@/components/settings/SettingsForm";

export const metadata = { title: "Settings · Farabi" };

export default function SettingsPage() {
  return (
    <div className="settings-stack">
      <SettingsForm />
      <section className="settings-page settings-page-app">
        <AppSettingsSections />
      </section>
    </div>
  );
}
