async function main() {
  const hre = require('hardhat');
  const RentAgent = await hre.ethers.getContractFactory('RentAgent');
  const rentAgent = await RentAgent.deploy();
  await rentAgent.deployed();
  console.log('RentAgent deployed to:', rentAgent.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
