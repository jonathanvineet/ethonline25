import hre from 'hardhat';

async function main() {
  const RentAgent = await hre.ethers.getContractFactory('RentAgent');
  const rentAgent = await RentAgent.deploy();
  await rentAgent.waitForDeployment();
  console.log('RentAgent deployed to:', await rentAgent.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
