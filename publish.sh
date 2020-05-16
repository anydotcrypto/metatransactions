set -e

VERSION=$1
TAG=${2:-latest}

if [ "$#" -ne 2 ]
then
  echo 'Usage: Supply a version and a tag 
       ./publish.sh (<newversion> | major | minor | patch | premajor | preminor | prepatch | prerelease | from-git) (tag)
       
       Eg: ./publish.sh prerelease next'
  exit 1
fi

echo "Version : $VERSION"
echo "Tag $TAG"

pnpm run clean
pnpm i --frozen-lockfile
pnpm run build
pnpm run build-ts
pnpm run publish-contracts
pnpm run test
pnpm --filter . exec -- npm version $VERSION
git push
pnpm publish --access public --tag $TAG
