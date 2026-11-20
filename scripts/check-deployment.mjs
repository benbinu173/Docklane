import { validateDeployment } from './deployment-config.mjs'
try {
  validateDeployment(process.env, process.argv[2])
  console.log(`Docklane ${process.argv[2]} deployment configuration passed; no values printed.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
