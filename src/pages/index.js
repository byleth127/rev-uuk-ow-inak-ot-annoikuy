import React from "react";
import { graphql } from "gatsby";

import PageHome from "miko/src/components/PageHome";

export default function PageIndex(props) {
  return <PageHome {...props} />;
}

export const pageQuery = graphql`
  query {
    thumbnails: allFile(
      sort: { fields: dir }
      filter: { name: { regex: "/^thumbnail/" } }
    ) {
      edges {
        node {
          publicURL
          relativePath
          name
        }
      }
    }
  }
`;
