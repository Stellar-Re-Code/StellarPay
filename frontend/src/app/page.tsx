export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
        StellarPay
      </h1>
      <p className="text-xl text-gray-400 mb-8 text-center max-w-2xl">
        Decentralized Payroll &amp; Token Vesting Protocol on Stellar Soroban
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
        <DashboardCard
          title="Payroll"
          description="Continuous payment streaming, claimable in real-time"
          href="/payroll"
          icon="💸"
        />
        <DashboardCard
          title="Vesting"
          description="Cliff + linear vesting schedules for your team"
          href="/vesting"
          icon="⏳"
        />
        <DashboardCard
          title="Treasury"
          description="Migrated to StellarSentinel — multi-sig vault"
          href="/treasury"
          icon="🏦"
          deprecated
        />
        <DashboardCard
          title="Governance"
          description="Migrated to StellarSentinel — proposals &amp; voting"
          href="/governance"
          icon="🗳️"
          deprecated
        />
      </div>
    </div>
  );
}

function DashboardCard({
  title,
  description,
  href,
  icon,
  deprecated,
}: {
  title: string;
  description: string;
  href: string;
  icon: string;
  deprecated?: boolean;
}) {
  return (
    <a
      href={href}
      className={`group rounded-xl border p-6 transition-all ${
        deprecated
          ? "border-gray-700/50 bg-gray-800/30 opacity-60 hover:border-yellow-600/50 hover:opacity-80"
          : "border-gray-700 bg-gray-800/50 hover:border-purple-500/50 hover:bg-gray-800"
      }`}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="flex items-center gap-2 mb-2">
        <h2
          className={`text-xl font-semibold transition-colors ${
            deprecated
              ? "text-gray-500 group-hover:text-yellow-500"
              : "group-hover:text-purple-400"
          }`}
        >
          {title}
        </h2>
        {deprecated && (
          <span className="text-[10px] uppercase tracking-wider bg-yellow-900/50 text-yellow-500 px-2 py-0.5 rounded-full border border-yellow-800/50">
            Deprecated
          </span>
        )}
      </div>
      <p className="text-gray-400 text-sm">{description}</p>
    </a>
  );
}
