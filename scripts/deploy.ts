import hre from 'hardhat';

async function main() {
  const RentAgent = await hre.ethers.getContractFactory('RentAgent');
  const rentAgent = await RentAgent.deploy();
  await rentAgent.deployed();
  console.log('RentAgent deployed to:', rentAgent.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
