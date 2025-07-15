import React from 'react'

const BetaBanner = () => {
  return (
    <div className="bg-yellow-400 text-gray-900 py-3 px-4 text-center text-xs sm:text-sm font-medium">
      <span className="inline-block max-w-4xl">
        Beta: resources are yet to be polished and can be incomplete (missing images, wrong links etc.) soon :) - if you want to get your resource listed, use the add widget on the left to make a PR. Thx.
      </span>
    </div>
  )
}

export default BetaBanner 