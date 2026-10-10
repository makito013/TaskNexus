// Boots v3 when a loader is given; any failure before render falls back to v2.
export async function runBoot({ loadV3, bootV2, onV3Error = console.error }) {
  if (!loadV3) return bootV2()
  try {
    const mod = await loadV3()
    return await mod.bootV3()
  } catch (err) {
    onV3Error(err)
    return bootV2()
  }
}
